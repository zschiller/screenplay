// Prevent a second console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Screenplay desktop shell (issue #418).
//!
//! Tauri owns the **Node sidecar's lifecycle**: it picks a free localhost port,
//! extracts and spawns the bundled Next standalone server, waits for its
//! `/api/health` to go green before pointing the webview at it (no first-paint
//! race), and kills + reaps the child on exit. The packaging approach is the one
//! de-risked in spike #407; the load-bearing details are commented inline.

mod dialog;
mod secrets;
mod sidecar;
mod thumbnail;

use std::sync::Mutex;

use sidecar::Sidecar;
use tauri::{Manager, RunEvent};
#[cfg(target_os = "macos")]
use tauri::WindowEvent;

/// The running sidecar, parked in Tauri managed state so the exit handler can
/// reap it. `None` until `setup` spawns it (or after a clean shutdown).
struct SidecarState(Mutex<Option<Sidecar>>);

fn main() {
    // Kill macOS "smart" text substitution in the webview. WKWebView routes
    // editable content (the terminal's hidden input, the chat composer, …)
    // through AppKit's text machinery, which by default rewrites `-- ` → `— `,
    // straight quotes → curly quotes, etc. That corrupts what you type into a
    // shell. Registering these as OFF in the app's registration domain flips the
    // default without overriding an explicit user choice in System Settings.
    #[cfg(target_os = "macos")]
    unsafe {
        disable_smart_substitutions();
    }

    tauri::Builder::default()
        // Native file/folder dialogs, used Rust-side only (the control
        // server's /pick-directory) — no webview capability is exposed.
        .plugin(tauri_plugin_dialog::init())
        // Opens external links (PR/GitHub URLs) in the system browser. The
        // webview itself can't honor `window.open`/`target="_blank"`, so the
        // page routes those clicks through `plugin:opener|open_url`.
        .plugin(tauri_plugin_opener::init())
        // Remember the main window's size + position across launches. The plugin
        // restores saved geometry when the config-defined window is created and
        // writes it back on close/exit, falling back to the tauri.conf.json
        // defaults on first run.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // macOS window lifecycle: the app has a single window and no way to
        // spawn another from within the UI, so if closing the red button
        // *destroyed* the window there'd be no way to get it back (the app keeps
        // running in the Dock). Instead, intercept the close and just hide the
        // window — Cmd+Q still quits (that's `ExitRequested`), and clicking the
        // Dock icon (`RunEvent::Reopen`, handled below) shows it again. Hiding
        // rather than recreating also preserves the live webview + its sidecar
        // connection, so there's no reload/flash on reopen.
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Bring the sidecar up: extract the bundled tree, pick a port, spawn
            // `node server.js`, and start the thumbnail control server. All the
            // fallible packaging work lives in `sidecar::launch`.
            let sidecar = sidecar::launch(&handle)?;
            let port = sidecar.port;
            app.manage(SidecarState(Mutex::new(Some(sidecar))));

            // Gate first paint on health off the UI thread: poll `/api/health`,
            // then navigate the (loading-screen) webview to the live server.
            std::thread::spawn(move || match sidecar::wait_until_healthy(port) {
                Ok(()) => {
                    let url = format!("http://127.0.0.1:{port}/");
                    if let (Some(window), Ok(parsed)) =
                        (handle.get_webview_window("main"), url.parse())
                    {
                        if let Err(e) = window.navigate(parsed) {
                            eprintln!("[shell] navigate failed: {e}");
                        }
                    }
                }
                Err(e) => eprintln!("[shell] sidecar never became healthy: {e}"),
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Screenplay desktop shell")
        .run(|app, event| {
            match event {
                // Clean shutdown: kill + wait the sidecar so it never outlives the
                // app (verified no orphan in spike #407, even on a boot crash).
                RunEvent::ExitRequested { .. } => {
                    if let Some(state) = app.try_state::<SidecarState>() {
                        if let Some(mut sidecar) = state.0.lock().unwrap().take() {
                            sidecar.shutdown();
                        }
                    }
                }
                // Dock-icon click on macOS. `CloseRequested` hides the window
                // rather than destroying it, so reopening is a restore of the
                // still-live webview. Fire regardless of `has_visible_windows`:
                // `applicationShouldHandleReopen` returns that flag, and returning
                // it suppresses AppKit's own de-miniaturize/restore, so we must
                // handle every reopen ourselves. `unminimize` restores a window
                // sent to the Dock by the yellow button; `show` un-hides one
                // hidden by a prior red-button close; `set_focus` brings it
                // forward. Each is a no-op when it doesn't apply.
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        });
}

/// Register the AppKit automatic-substitution defaults as OFF for this app, so
/// WKWebView's editable content stops rewriting keystrokes (smart dashes/quotes,
/// text replacement, auto-capitalization, spelling correction). `registerDefaults`
/// only seeds the registration domain — the lowest-priority layer — so a user who
/// has deliberately toggled one of these in System Settings still wins.
#[cfg(target_os = "macos")]
unsafe fn disable_smart_substitutions() {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let defaults: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
    if defaults.is_null() {
        return;
    }
    let dict: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
    if dict.is_null() {
        return;
    }
    let no: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: false];

    for key in [
        "NSAutomaticDashSubstitutionEnabled",
        "NSAutomaticQuoteSubstitutionEnabled",
        "NSAutomaticTextReplacementEnabled",
        "NSAutomaticSpellingCorrectionEnabled",
        "NSAutomaticPeriodSubstitutionEnabled",
        "NSAutomaticCapitalizationEnabled",
    ] {
        let Ok(cstr) = std::ffi::CString::new(key) else {
            continue;
        };
        let nskey: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: cstr.as_ptr()];
        if nskey.is_null() {
            continue;
        }
        let _: () = msg_send![dict, setObject: no, forKey: nskey];
    }

    let _: () = msg_send![defaults, registerDefaults: dict];
}
