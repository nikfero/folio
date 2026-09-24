use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;

/// A request to open a document (or a folder) in a window. `content` carries
/// unsaved text when a dirty tab is moved to another window.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct OpenRequest {
    path: Option<String>,
    content: Option<String>,
    #[serde(default)]
    folder: Option<String>,
}

/// Documents waiting for a window whose frontend has not finished loading yet.
#[derive(Default)]
struct Handoff {
    pending: Mutex<HashMap<String, Vec<OpenRequest>>>,
    ready: Mutex<HashSet<String>>,
}

/// Whether windows get a menu bar (Windows/Linux). Stored in a small file in
/// the app config directory, because it must be known before a window is
/// created: attaching or removing a menu later changes the window's size.
#[derive(Default)]
struct MenuBarPref(AtomicBool);

fn menu_pref_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("menu-bar"))
}

fn load_menu_pref(app: &AppHandle) -> bool {
    menu_pref_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .is_some_and(|s| s.trim() == "1")
}

fn wants_menu(app: &AppHandle) -> bool {
    cfg!(not(target_os = "macos")) && app.state::<MenuBarPref>().0.load(Ordering::Relaxed)
}

#[derive(Serialize)]
struct TextFile {
    text: String,
    bom: bool,
    mtime: Option<u64>,
}

fn mtime_of(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

#[tauri::command]
fn read_text(path: String) -> Result<TextFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (bom, body) = match bytes.strip_prefix(b"\xEF\xBB\xBF") {
        Some(rest) => (true, rest),
        None => (false, &bytes[..]),
    };
    Ok(TextFile {
        text: String::from_utf8_lossy(body).into_owned(),
        bom,
        mtime: mtime_of(Path::new(&path)),
    })
}

/// Writes the file and returns its new modification time.
#[tauri::command]
fn write_text(path: String, text: String, bom: bool) -> Result<Option<u64>, String> {
    let mut bytes = Vec::with_capacity(text.len() + 3);
    if bom {
        bytes.extend_from_slice(b"\xEF\xBB\xBF");
    }
    bytes.extend_from_slice(text.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(mtime_of(Path::new(&path)))
}

const MARKDOWN_EXTS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];
/// Directories that never contain documents worth browsing.
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "vendor", "__pycache__", "venv"];
const MAX_FILES: usize = 10_000;

#[derive(Serialize)]
struct FolderEntry {
    path: String,
    /// Path relative to the folder, always with `/` separators.
    rel: String,
}

#[derive(Serialize)]
struct FolderListing {
    files: Vec<FolderEntry>,
    /// Empty folders (relative, `/`-separated), so newly created folders show up.
    dirs: Vec<String>,
    truncated: bool,
}

fn rel_path(path: &Path, root: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MARKDOWN_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

fn walk(dir: &Path, root: &Path, depth: usize, out: &mut Vec<FolderEntry>, empty: &mut Vec<String>) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    let mut entries: Vec<_> = entries.flatten().collect();
    if entries.is_empty() && dir != root {
        empty.push(rel_path(dir, root));
    }
    entries.sort_by_key(|e| e.file_name().to_ascii_lowercase());
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        // file_type() doesn't follow symlinks, so linked directories (and loops) are skipped.
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            if depth < 16 && !SKIP_DIRS.contains(&name.as_ref()) && walk(&path, root, depth + 1, out, empty) {
                return true;
            }
        } else if kind.is_file() && is_markdown(&path) {
            if out.len() >= MAX_FILES {
                return true;
            }
            out.push(FolderEntry {
                rel: rel_path(&path, root),
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    false
}

/// Lists the Markdown files under `root`, skipping hidden and build directories.
#[tauri::command]
fn list_folder(root: String) -> Result<FolderListing, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    let truncated = walk(&root, &root, 0, &mut files, &mut dirs);
    Ok(FolderListing { files, dirs, truncated })
}

const MAX_MATCHES: usize = 2_000;
const MAX_MATCHES_PER_FILE: usize = 200;
const MAX_SEARCH_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize)]
struct LineMatch {
    /// 1-based line number.
    line: usize,
    /// Match start and length in UTF-16 units (JavaScript string offsets) within `text`'s line.
    col: usize,
    len: usize,
    text: String,
}

#[derive(Serialize)]
struct FileMatches {
    path: String,
    rel: String,
    matches: Vec<LineMatch>,
}

#[derive(Serialize)]
struct SearchResults {
    files: Vec<FileMatches>,
    total: usize,
    truncated: bool,
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Escapes a literal query. Case-insensitively, the Turkish dotted and dotless
/// i (İ ı) also match i and I, which Unicode's simple case folding doesn't do.
fn literal_pattern(query: &str, case_insensitive: bool) -> String {
    query
        .chars()
        .map(|c| match c {
            'i' | 'I' | 'İ' | 'ı' if case_insensitive => "[iIİı]".to_string(),
            _ => regex::escape(&c.to_string()),
        })
        .collect()
}

/// Searches the folder's Markdown files for `query` (literal unless `regex`).
#[tauri::command(async)]
fn search_folder(root: String, query: String, case_sensitive: bool, regex: bool) -> Result<SearchResults, String> {
    let pattern = if regex { query } else { literal_pattern(&query, !case_sensitive) };
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| format!("Invalid regular expression: {e}"))?;
    let root = PathBuf::from(root);
    let mut entries = Vec::new();
    let mut dirs = Vec::new();
    walk(&root, &root, 0, &mut entries, &mut dirs);

    let mut files = Vec::new();
    let mut total = 0;
    let mut truncated = false;
    'files: for entry in entries {
        let path = Path::new(&entry.path);
        if std::fs::metadata(path).map(|m| m.len() > MAX_SEARCH_FILE_BYTES).unwrap_or(true) {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        let mut matches = Vec::new();
        for (i, line) in text.lines().enumerate() {
            for m in re.find_iter(line) {
                if m.start() == m.end() {
                    continue; // skip empty regex matches
                }
                matches.push(LineMatch {
                    line: i + 1,
                    col: utf16_len(&line[..m.start()]),
                    len: utf16_len(m.as_str()),
                    text: line.to_string(),
                });
                total += 1;
                if total >= MAX_MATCHES {
                    truncated = true;
                    files.push(FileMatches { path: entry.path, rel: entry.rel, matches });
                    break 'files;
                }
                if matches.len() >= MAX_MATCHES_PER_FILE {
                    truncated = true;
                    break;
                }
            }
            if matches.len() >= MAX_MATCHES_PER_FILE {
                break;
            }
        }
        if !matches.is_empty() {
            files.push(FileMatches { path: entry.path, rel: entry.rel, matches });
        }
    }
    Ok(SearchResults { files, total, truncated })
}

/// Creates an empty file; fails if something already exists at `path`.
#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("Something with that name already exists.".into());
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Renames or moves a file or folder without overwriting anything.
#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let (src, dst) = (Path::new(&from), Path::new(&to));
    // A case-only rename ("a.md" -> "A.md") on a case-insensitive disk finds the
    // target "existing"; go through a temporary name instead.
    let case_only = from != to
        && from.to_lowercase() == to.to_lowercase()
        && std::fs::canonicalize(src).ok() == std::fs::canonicalize(dst).ok();
    if dst.exists() && !case_only {
        return Err("Something with that name already exists.".into());
    }
    if case_only {
        let tmp = src.with_file_name(format!(
            ".folio-rename-{}",
            std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default()
        ));
        std::fs::rename(src, &tmp).map_err(|e| e.to_string())?;
        return std::fs::rename(&tmp, dst).map_err(|e| e.to_string());
    }
    std::fs::rename(src, dst).map_err(|e| e.to_string())
}

/// Moves a file or folder to the Recycle Bin / Trash (never deletes outright).
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// Saves a pasted image into `<dir>/images/`, picking a free name based on
/// `file_name`. Returns the path relative to `dir` (with `/`), for the Markdown link.
#[tauri::command]
fn save_image(dir: String, file_name: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let images = Path::new(&dir).join("images");
    std::fs::create_dir_all(&images).map_err(|e| e.to_string())?;
    let clean: String = file_name
        .chars()
        .map(|c| if c.is_alphanumeric() || "-_.".contains(c) { c } else { '-' })
        .collect();
    let (stem, ext) = clean.rsplit_once('.').unwrap_or((&clean, "png"));
    let mut name = format!("{stem}.{ext}");
    let mut n = 2;
    while images.join(&name).exists() {
        name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    std::fs::write(images.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("images/{name}"))
}

/// Modification time in ms, or None if the file no longer exists.
#[tauri::command]
fn file_mtime(path: String) -> Option<u64> {
    mtime_of(Path::new(&path))
}

/// Opens the system print dialog for the calling window (WKWebView on macOS
/// doesn't support `window.print()`).
#[tauri::command]
fn print_window(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Called by each window once its listeners are registered; returns the
/// documents that were queued for it before it was ready.
#[tauri::command]
fn frontend_ready(window: WebviewWindow, state: tauri::State<Handoff>) -> Vec<OpenRequest> {
    let label = window.label().to_string();
    state.ready.lock().unwrap().insert(label.clone());
    state.pending.lock().unwrap().remove(&label).unwrap_or_default()
}

#[tauri::command]
fn new_window(app: AppHandle, docs: Vec<OpenRequest>) -> Result<(), String> {
    open_window(&app, docs).map_err(|e| e.to_string())
}

fn open_window(app: &AppHandle, docs: Vec<OpenRequest>) -> tauri::Result<()> {
    let label = format!(
        "win-{}",
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros())
            .unwrap_or_default()
    );
    app.state::<Handoff>()
        .pending
        .lock()
        .unwrap()
        .insert(label.clone(), docs);
    create_window(app, &label)
}

fn create_window(app: &AppHandle, label: &str) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Folio")
        .inner_size(1100.0, 760.0)
        .min_inner_size(480.0, 320.0)
        .visible(false); // shown by the frontend once it has rendered
    if wants_menu(app) {
        builder = builder.menu(build_menu(app)?);
    }
    let window = builder.build()?;
    disable_browser_keys(&window);
    Ok(())
}

/// Folio is an app, not a browser: WebView2's own shortcuts (developer tools,
/// find on page, reload, print, back/forward) are switched off. The page still
/// receives the keys, so Folio's shortcuts keep working. macOS and Linux
/// webviews have no such shortcuts. Set FOLIO_DEVTOOLS=1 in a debug build to
/// keep them (F12 opens the developer tools).
fn disable_browser_keys(window: &WebviewWindow) {
    if cfg!(debug_assertions) && std::env::var_os("FOLIO_DEVTOOLS").is_some() {
        return;
    }
    #[cfg(windows)]
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        let Ok(settings) = webview.controller().CoreWebView2().and_then(|core| core.Settings()) else {
            return;
        };
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
    #[cfg(not(windows))]
    let _ = window;
}

/// Delivers documents to a window: directly if its frontend is ready,
/// otherwise queued until it calls `frontend_ready`.
fn deliver(app: &AppHandle, label: &str, docs: Vec<OpenRequest>) {
    let state = app.state::<Handoff>();
    if state.ready.lock().unwrap().contains(label) {
        let _ = app.emit_to(label, "open-docs", docs);
    } else {
        state
            .pending
            .lock()
            .unwrap()
            .entry(label.to_string())
            .or_default()
            .extend(docs);
    }
}

/// The window that should receive files opened from the OS: the focused one,
/// else "main", else any.
fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .cloned()
}

/// Whether windows currently get a menu bar (always false on macOS, where the
/// global menu bar is always present).
#[tauri::command]
fn menu_visible(app: AppHandle) -> bool {
    wants_menu(&app)
}

/// Turns the menu bar on or off for all windows (Windows/Linux; macOS always
/// has its global menu bar). Does nothing if it is already in that state.
#[tauri::command]
fn set_menu_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if cfg!(target_os = "macos") || app.state::<MenuBarPref>().0.swap(visible, Ordering::Relaxed) == visible {
        return Ok(());
    }
    if let Some(file) = menu_pref_file(&app) {
        let _ = std::fs::create_dir_all(file.parent().unwrap_or(Path::new(".")));
        let _ = std::fs::write(file, if visible { "1" } else { "0" });
    }
    for win in app.webview_windows().values() {
        let result = if visible {
            build_menu(&app).and_then(|m| win.set_menu(m).map(|_| ()))
        } else {
            win.remove_menu().map(|_| ())
        };
        result.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Builds the application menu. Every custom item's id is a frontend command
/// name; clicks are forwarded to the focused window as a "menu" event.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, text);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new-tab", "New Tab", Some("CmdOrCtrl+T"))?)
        .item(&item("new-window", "New Window", Some("CmdOrCtrl+Shift+N"))?)
        .separator()
        .item(&item("open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&item("open-folder", "Open Folder…", Some("CmdOrCtrl+Alt+O"))?)
        .item(&item("quick-open", "Quick Open…", Some("CmdOrCtrl+P"))?)
        .item(&item("close-folder", "Close Folder", None)?)
        .separator()
        .item(&item("save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item("save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&item("reload", "Reload from Disk", None)?)
        .item(&item("reveal", "Reveal in Folder", None)?)
        .separator()
        .item(&item("export-html", "Export as HTML…", None)?)
        .item(&item("print", "Print / Save as PDF…", None)?)
        .separator()
        .item(&item("close-tab", "Close Tab", Some("CmdOrCtrl+W"))?);
    #[cfg(not(target_os = "macos"))]
    let file = file
        .separator()
        .item(&item("settings", "Settings…", Some("Ctrl+,"))?)
        .separator()
        .quit_with_text("Exit");

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("mode-read", "Read", None)?)
        .item(&item("mode-live", "Live Preview", None)?)
        .item(&item("mode-split", "Split", None)?)
        .item(&item("mode-edit", "Edit", None)?)
        .item(&item("cycle-mode", "Cycle View Mode", Some("CmdOrCtrl+E"))?)
        .separator()
        .item(&item("command-palette", "Command Palette…", Some("CmdOrCtrl+Shift+P"))?)
        .separator()
        .item(&item("toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+\\"))?)
        .item(&item("toggle-focus", "Focus Mode", Some("CmdOrCtrl+Shift+Enter"))?)
        .item(&item(
            "toggle-fullscreen",
            "Full Screen",
            Some(if cfg!(target_os = "macos") { "Ctrl+Cmd+F" } else { "F11" }),
        )?)
        .item(&item("show-files", "Show Files", None)?)
        .item(&item("search-folder", "Search in Folder", Some("CmdOrCtrl+Shift+F"))?)
        .item(&item("toggle-outline", "Show Outline", Some("CmdOrCtrl+Shift+O"))?)
        .item(&item("find", "Find", Some("CmdOrCtrl+F"))?)
        .item(&item("toggle-theme", "Toggle Light / Dark Theme", None)?)
        .separator()
        .item(&item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?);

    let tabs = SubmenuBuilder::new(app, "Tab")
        .item(&item("next-tab", "Next Tab", Some("Ctrl+Tab"))?)
        .item(&item("prev-tab", "Previous Tab", Some("Ctrl+Shift+Tab"))?)
        .separator()
        .item(&item("move-tab", "Move Tab to New Window", None)?);

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "Folio")
            .about(None)
            .separator()
            .item(&item("settings", "Settings…", Some("Cmd+,"))?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        // The Edit menu is what makes Cmd+C/V/X/Z work inside the webview on macOS.
        let edit = SubmenuBuilder::new(app, "Edit")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;
        let window = SubmenuBuilder::new(app, "Window")
            .minimize()
            .maximize()
            .fullscreen()
            .separator()
            .close_window()
            .build()?;
        Menu::with_items(app, &[&app_menu, &file.build()?, &edit, &view.build()?, &tabs.build()?, &window])
    }
    #[cfg(not(target_os = "macos"))]
    {
        let help = SubmenuBuilder::new(app, "Help")
            .item(&item("about", "About Folio", None)?)
            .build()?;
        Menu::with_items(app, &[&file.build()?, &view.build()?, &tabs.build()?, &help])
    }
}

fn docs_from_args(args: &[String], cwd: &Path) -> Vec<OpenRequest> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .filter_map(|p| {
            let abs = std::path::absolute(&p).unwrap_or(p).to_string_lossy().into_owned();
            let abs_path = Path::new(&abs);
            if abs_path.is_file() {
                Some(OpenRequest { path: Some(abs), ..Default::default() })
            } else if abs_path.is_dir() {
                Some(OpenRequest { folder: Some(abs), ..Default::default() })
            } else {
                None
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let docs = docs_from_args(&args, Path::new(&cwd));
            if let Some(win) = target_window(app) {
                let _ = win.unminimize();
                let _ = win.set_focus();
                if !docs.is_empty() {
                    deliver(app, win.label(), docs);
                }
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Only the main window remembers its size and position; the
                // frontend decides when to show it.
                .with_filter(|label| label == "main")
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Handoff::default())
        .manage(MenuBarPref::default())
        .on_menu_event(|app, event| {
            let id = event.id().0.clone();
            match target_window(app) {
                Some(win) => {
                    let _ = win.emit_to(win.label(), "menu", id);
                }
                None if id == "new-window" || id == "new-tab" || id == "open" => {
                    let _ = open_window(app, Vec::new());
                }
                None => {}
            }
        })
        .setup(|app| {
            let pref = load_menu_pref(app.handle());
            app.state::<MenuBarPref>().0.store(pref, Ordering::Relaxed);
            // macOS has one global menu bar; elsewhere each window gets its own (if enabled).
            #[cfg(target_os = "macos")]
            app.set_menu(build_menu(app.handle())?)?;
            create_window(app.handle(), "main")?;

            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            let docs = docs_from_args(&args, &cwd);
            if !docs.is_empty() {
                deliver(app.handle(), "main", docs);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            file_mtime,
            frontend_ready,
            print_window,
            list_folder,
            search_folder,
            create_file,
            create_dir,
            rename_path,
            trash_path,
            save_image,
            new_window,
            menu_visible,
            set_menu_visible
        ])
        .build(tauri::generate_context!())
        .expect("error while building Folio")
        .run(|app, event| match event {
            // macOS delivers "Open With" / double-clicked files as URLs.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                let docs: Vec<OpenRequest> = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| {
                        let path = p.to_string_lossy().into_owned();
                        if p.is_dir() {
                            OpenRequest { folder: Some(path), ..Default::default() }
                        } else {
                            OpenRequest { path: Some(path), ..Default::default() }
                        }
                    })
                    .collect();
                let label = target_window(app)
                    .map(|w| w.label().to_string())
                    .unwrap_or_else(|| "main".into());
                deliver(app, &label, docs);
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                app.state::<Handoff>().ready.lock().unwrap().remove(&label);
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh scratch folder under the system temp directory.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folio-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn lists_markdown_and_skips_noise() {
        let dir = scratch("list");
        std::fs::create_dir_all(dir.join("docs/deep")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join("empty")).unwrap();
        std::fs::write(dir.join("README.md"), "# hi").unwrap();
        std::fs::write(dir.join("docs/deep/Guide.MD"), "x").unwrap();
        std::fs::write(dir.join("docs/notes.txt"), "x").unwrap();
        std::fs::write(dir.join("node_modules/pkg/readme.md"), "x").unwrap();
        std::fs::write(dir.join(".git/info.md"), "x").unwrap();

        let listing = list_folder(s(&dir)).unwrap();
        let rels: Vec<_> = listing.files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(rels, ["docs/deep/Guide.MD", "README.md"]);
        assert_eq!(listing.dirs, ["empty"]);
        assert!(!listing.truncated);
    }

    #[test]
    fn searches_with_unicode_case_folding_and_utf16_offsets() {
        let dir = scratch("search");
        // "é" and "😀" are multi-byte in UTF-8; offsets must be UTF-16 for JavaScript.
        std::fs::write(dir.join("a.md"), "Café 😀 İstanbul\r\nsecond ISTANBUL line\n").unwrap();
        let r = search_folder(s(&dir), "istanbul".into(), false, false).unwrap();
        assert_eq!(r.total, 2);
        let m = &r.files[0].matches;
        assert_eq!((m[0].line, m[0].col), (1, 8)); // "Café " (5) + "😀" (2) + " " (1)
        assert_eq!(m[1].line, 2);
        assert!(!m[1].text.ends_with('\r'));

        let literal = search_folder(s(&dir), "a.".into(), false, false).unwrap();
        assert_eq!(literal.total, 0, "query is literal unless regex is on");
        let re = search_folder(s(&dir), "caf.".into(), false, true).unwrap();
        assert_eq!(re.total, 1);
        assert!(search_folder(s(&dir), "(".into(), false, true).is_err());
    }

    #[test]
    fn create_and_rename_never_overwrite() {
        let dir = scratch("ops");
        let a = dir.join("a.md");
        let b = dir.join("b.md");
        create_file(s(&a)).unwrap();
        assert!(create_file(s(&a)).is_err(), "create_file must not overwrite");
        std::fs::write(&b, "keep me").unwrap();
        assert!(rename_path(s(&a), s(&b)).is_err(), "rename must not overwrite");
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "keep me");

        rename_path(s(&a), s(&dir.join("c.md"))).unwrap();
        assert!(dir.join("c.md").exists() && !a.exists());

        create_dir(s(&dir.join("sub"))).unwrap();
        assert!(create_dir(s(&dir.join("sub"))).is_err());
    }

    #[test]
    fn saves_pasted_images_with_unique_names() {
        use base64::Engine;
        let dir = scratch("img");
        let data = base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3]);
        let first = save_image(s(&dir), "shot.png".into(), data.clone()).unwrap();
        let second = save_image(s(&dir), "shot.png".into(), data).unwrap();
        assert_eq!(first, "images/shot.png");
        assert_eq!(second, "images/shot-2.png");
        assert_eq!(std::fs::read(dir.join("images/shot-2.png")).unwrap(), [1, 2, 3]);
        let odd = save_image(s(&dir), "my file?.png".into(), "AQ==".into()).unwrap();
        assert_eq!(odd, "images/my-file-.png");
    }

    #[test]
    fn keeps_bom_and_text_exactly() {
        let dir = scratch("bom");
        let path = s(&dir.join("x.md"));
        write_text(path.clone(), "a\r\nb".into(), true).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"\xEF\xBB\xBFa\r\nb");
        let f = read_text(path).unwrap();
        assert!(f.bom);
        assert_eq!(f.text, "a\r\nb");
    }
}
