use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// A request to open a document in a window. `content` carries unsaved text
/// when a dirty tab is moved to another window.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct OpenRequest {
    path: Option<String>,
    content: Option<String>,
}

/// Documents waiting for a window whose frontend has not finished loading yet.
#[derive(Default)]
struct Handoff {
    pending: Mutex<HashMap<String, Vec<OpenRequest>>>,
    ready: Mutex<HashSet<String>>,
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

/// Modification time in ms, or None if the file no longer exists.
#[tauri::command]
fn file_mtime(path: String) -> Option<u64> {
    mtime_of(Path::new(&path))
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
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Folio")
        .inner_size(1100.0, 760.0)
        .min_inner_size(480.0, 320.0)
        .build()?;
    Ok(())
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
        .filter(|p| p.is_file())
        .map(|p| OpenRequest {
            path: Some(std::path::absolute(&p).unwrap_or(p).to_string_lossy().into_owned()),
            content: None,
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Handoff::default())
        .setup(|app| {
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
            new_window
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
                    .map(|p| OpenRequest {
                        path: Some(p.to_string_lossy().into_owned()),
                        content: None,
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
