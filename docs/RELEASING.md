# Releasing Folio

GitHub Actions builds Folio for every platform. You never need a Mac or Linux machine: every release produces installers for all three.

| Platform | Files |
|---|---|
| Windows | `Folio_<version>_x64-setup.exe` (installer), `Folio_<version>_x64_en-US.msi` |
| macOS (Apple Silicon) | `Folio_<version>_aarch64.dmg` |
| macOS (Intel) | `Folio_<version>_x64.dmg` |
| Linux | `.AppImage` (runs anywhere), `.deb` (Debian/Ubuntu), `.rpm` (Fedora/openSUSE) |

The builds always land in a **draft** release first. Nobody else sees them until you publish.

There are two ways to make a release. Use whichever you prefer.

- [Option A: from the GitHub website](#option-a-from-the-github-website): no tools needed
- [Option B: from the command line](#option-b-from-the-command-line): with git

---

## Choosing a version number

Folio uses [semantic versioning](https://semver.org), `MAJOR.MINOR.PATCH`:

| Change | Example |
|---|---|
| Bug fixes only | `0.1.0` → `0.1.1` |
| New features | `0.1.0` → `0.2.0` |
| First stable release, or breaking changes | `0.9.0` → `1.0.0` |

The version is stored in three files:

| File | Line | Needed? |
|---|---|---|
| `src-tauri/tauri.conf.json` | `"version": "0.1.0"` | **Yes.** This sets the installer names, the release name and the version shown by the app. |
| `package.json` | `"version": "0.1.0"` | Optional, for tidiness |
| `src-tauri/Cargo.toml` | `version = "0.1.0"` | Optional, for tidiness |

---

## Option A: from the GitHub website

### 1. Update the version

Skip this step if the version in `tauri.conf.json` is already the one you want to release.

1. Open [`src-tauri/tauri.conf.json`](https://github.com/nikfero/folio/blob/main/src-tauri/tauri.conf.json) on GitHub.
2. Click the **pencil icon** (*Edit this file*).
3. Change `"version": "0.1.0"` to the new version, e.g. `"0.2.0"`.
4. Click **Commit changes…**, leave *Commit directly to the `main` branch* selected, and confirm.

### 2. Start the build

1. Open the [**Actions**](https://github.com/nikfero/folio/actions) tab.
2. Click **Release** in the left sidebar.
3. Click **Run workflow** on the right, keep the branch as `main`, and click the green **Run workflow** button.
4. Wait about **10–20 minutes**, until all four jobs have a green check:
   - `build (windows-latest)`
   - `build (macos-latest, --target aarch64-apple-darwin)`
   - `build (macos-latest, --target x86_64-apple-darwin)`
   - `build (ubuntu-22.04)`

### 3. Publish the release

1. Open [**Releases**](https://github.com/nikfero/folio/releases).
2. Open the draft **Folio v0.2.0** and check that all the installers are listed under *Assets*.
3. Click the **pencil icon**, write release notes (or click **Generate release notes** to list the commits since the last release), and click **Publish release**.

When you publish, GitHub creates the `v0.2.0` tag automatically.

> **Avoid "Draft a new release" for this.** Creating a release by hand on the Releases page also creates a tag, which starts a build too. The release is then already public while the installers are still being added to it. The **Actions → Run workflow** route gives you a draft to check first.

---

## Option B: from the command line

### 1. Update the version

Edit the version in `src-tauri/tauri.conf.json` (and, if you like, in `package.json` and `src-tauri/Cargo.toml`).

### 2. Commit, tag and push

```bash
git commit -am "Release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

The tag **must** start with `v`: pushing a `v*` tag is what starts the Release workflow.

### 3. Follow the build

```bash
gh run watch
```

or watch it in the [Actions](https://github.com/nikfero/folio/actions) tab.

### 4. Publish the release

As in [Option A, step 3](#3-publish-the-release).

---

## Troubleshooting

### A build job failed

1. Open the failed run in [Actions](https://github.com/nikfero/folio/actions) and click the red job to read the error.
2. Delete the unfinished draft on the [Releases](https://github.com/nikfero/folio/releases) page (open it, then **Delete**).
3. Fix the problem, commit, and start the release again.

If you used a tag (Option B), delete it before tagging again:

```bash
git tag -d v0.2.0                     # delete it locally
git push origin :refs/tags/v0.2.0     # delete it on GitHub
```

On the website, tags can be deleted from **Code → Tags**: click the tag, then the **⋯** menu, then **Delete**.

### The installers were added to an old draft

A new run for the **same version** uploads into an existing draft of that version. Delete the old draft before running the workflow again.

### Test a build without releasing

Run the workflow (Option A, step 2), download the installers from the draft, and delete the draft when you're done. Nothing is published until you click **Publish release**.

---

## Good to know

### Who can download

The repository is **private**, so only people with access to it can see its releases. To share Folio publicly, either make the repository public (**Settings → General → Danger Zone → Change visibility**) or copy the installers somewhere else.

### Security warnings (unsigned builds)

The installers aren't code-signed yet, so each operating system warns the first time Folio is opened:

| OS | What you see | What to do |
|---|---|---|
| Windows | *"Windows protected your PC"* (SmartScreen) | Click **More info → Run anyway** |
| macOS | *"Folio can't be opened because Apple cannot check it"* | Right-click the app, choose **Open**, then **Open** again. Or run `xattr -cr /Applications/Folio.app` in Terminal. |
| Linux | Nothing, except that the AppImage has to be made executable | `chmod +x Folio_*.AppImage` |

Removing these warnings needs an Apple Developer account (US$99/year) for macOS and a code-signing certificate for Windows. Both can be added to the workflow later.

### Where this is configured

| File | What it does |
|---|---|
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Builds the installers and creates the draft release |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Checks every push to `main` (type check, frontend build, Rust lint) |
| [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) | App version, name, icons, file associations and bundle settings |
