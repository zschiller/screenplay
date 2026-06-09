// Prevent a second console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Screenplay desktop shell (issue #418).
//!
//! Tauri owns the **Node sidecar's lifecycle**: it picks a free localhost port,
//! extracts and spawns the bundled Next standalone server, waits for its
//! `/api/health` to go green before pointing the webview at it (no first-paint
//! race), and kills + reaps the child on exit. The packaging approach is the one
//! de-risked in spike #407; the load-bearing details are commented inline.

mod secrets;
mod sidecar;
mod thumbnail;

use std::sync::Mutex;

use sidecar::Sidecar;
use tauri::{Manager, RunEvent};

/// The running sidecar, parked in Tauri managed state so the exit handler can
/// reap it. `None` until `setup` spawns it (or after a clean shutdown).
struct SidecarState(Mutex<Option<Sidecar>>);

fn main() {
    tauri::Builder::default()
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
            // Clean shutdown: kill + wait the sidecar so it never outlives the
            // app (verified no orphan in spike #407, even on a boot crash).
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Some(mut sidecar) = state.0.lock().unwrap().take() {
                        sidecar.shutdown();
                    }
                }
            }
        });
}
