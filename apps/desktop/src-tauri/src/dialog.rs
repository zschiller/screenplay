//! Native folder-picker bridge (PRD #428).
//!
//! The add-Repo "choose a local folder" flow needs an OS directory dialog, but
//! the app page talks to the Node sidecar over localhost HTTP — it has no
//! Tauri IPC. So the sidecar forwards the request to the shell's control
//! server (`POST /pick-directory`, the same channel the thumbnail capturer
//! uses), and this opens the dialog and hands the chosen path back. Outside
//! the shell there is no control server and the UI falls back to a plain text
//! path input.

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Open a native directory dialog and return the chosen absolute path, or
/// `None` when the user cancels. Blocking is fine here: this runs on the
/// control server's worker thread (never the main thread, which the plugin's
/// blocking API must not be called from), and the server handles one request
/// at a time by design.
pub fn pick_directory(app: &AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|folder| folder.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}
