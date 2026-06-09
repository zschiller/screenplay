//! The localhost control server the desktop Thumbnail Capturer calls.
//!
//! The sidecar can't run a headless Chromium, so its `TauriWebviewCapturer`
//! POSTs `{ renderUrl }` here and expects PNG bytes back; the shell renders the
//! page in a webview and screenshots it. The server binds its own ephemeral port
//! (passed to the sidecar as `TAURI_CONTROL_URL`) so it never collides with the
//! app's port.

use std::error::Error;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Method, Response, Server};

/// Off-screen window the render page loads into for screenshotting. Reused
/// across captures (the control server handles one request at a time).
const CAPTURE_LABEL: &str = "thumbnail-capture";
/// Viewport the render page is screenshotted at — matches the puppeteer
/// capturer; downstream `sharp` resizes to the stored 640×480.
const CAPTURE_W: f64 = 1280.0;
const CAPTURE_H: f64 = 960.0;
/// Settle delay after the page's `load` before snapshotting, to let the canvas
/// paint (mirrors the puppeteer path's `__thumbnailReady` wait, with a fixed
/// budget since a remote page can't signal the shell back over IPC).
const SETTLE_MS: u64 = 1_500;
const CAPTURE_TIMEOUT_S: u64 = 25;

#[derive(Deserialize)]
struct ThumbnailRequest {
    #[serde(rename = "renderUrl")]
    render_url: String,
}

/// A tiny HTTP server bound to a localhost ephemeral port, serving `POST
/// /thumbnail`. Its lifetime is tied to the sidecar's (started in
/// `sidecar::launch`, stopped in `Sidecar::shutdown`).
pub struct ControlServer {
    port: u16,
    server: Arc<Server>,
    worker: Option<JoinHandle<()>>,
}

impl ControlServer {
    pub fn start(app: AppHandle) -> Result<Self, Box<dyn Error>> {
        let server = Arc::new(Server::http("127.0.0.1:0").map_err(|e| e.to_string())?);
        let port = server
            .server_addr()
            .to_ip()
            .ok_or("control server bound to a non-IP address")?
            .port();

        let srv = Arc::clone(&server);
        let worker = std::thread::spawn(move || serve(&srv, &app));
        Ok(Self {
            port,
            server,
            worker: Some(worker),
        })
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn stop(&mut self) {
        // Unblock `incoming_requests()` so the worker thread returns, then join.
        self.server.unblock();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn serve(server: &Server, app: &AppHandle) {
    for mut request in server.incoming_requests() {
        let handled =
            request.method() == &Method::Post && request.url().starts_with("/thumbnail");
        if !handled {
            let _ = request.respond(Response::from_string("not found").with_status_code(404));
            continue;
        }

        let mut body = String::new();
        if request.as_reader().read_to_string(&mut body).is_err() {
            let _ = request.respond(Response::from_string("bad body").with_status_code(400));
            continue;
        }

        let render_url = match serde_json::from_str::<ThumbnailRequest>(&body) {
            Ok(parsed) => parsed.render_url,
            Err(_) => {
                let _ =
                    request.respond(Response::from_string("bad json").with_status_code(400));
                continue;
            }
        };

        match capture(app, &render_url) {
            Ok(png) => {
                let header =
                    Header::from_bytes(&b"Content-Type"[..], &b"image/png"[..]).unwrap();
                let _ = request.respond(Response::from_data(png).with_header(header));
            }
            Err(e) => {
                eprintln!("[thumbnail] capture failed: {e}");
                let _ = request.respond(Response::from_string(e).with_status_code(500));
            }
        }
    }
}

/// Render `render_url` in an off-screen webview and return a PNG screenshot.
///
/// Tauri v2 has no portable screenshot API (the one piece spike #407 left open),
/// so this drives the underlying WKWebView's `takeSnapshot` on macOS. The
/// control server calls one capture at a time, so a single reused off-screen
/// window is safe. On any failure the capturer surfaces it and
/// `captureRoomThumbnail`'s caller swallows it — a Room just shows no thumbnail.
fn capture(app: &AppHandle, render_url: &str) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    // Window + webview work must run on the UI thread.
    let app_main = app.clone();
    let url = render_url.to_string();
    let tx_build = tx.clone();
    app.run_on_main_thread(move || {
        if let Err(e) = open_capture_window(&app_main, &url, tx_build.clone()) {
            let _ = tx_build.send(Err(e));
        }
    })
    .map_err(|e| e.to_string())?;

    let result = rx
        .recv_timeout(Duration::from_secs(CAPTURE_TIMEOUT_S))
        .unwrap_or_else(|_| Err("thumbnail capture timed out".into()));

    // Tear the off-screen window down regardless of outcome.
    if let Some(window) = app.get_webview_window(CAPTURE_LABEL) {
        let _ = window.destroy();
    }
    result
}

/// Build the off-screen capture window; on page `load` (+ settle), snapshot it.
fn open_capture_window(
    app: &AppHandle,
    url: &str,
    tx: mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    // A leftover window from a prior capture would make the build fail on a
    // duplicate label.
    if let Some(prev) = app.get_webview_window(CAPTURE_LABEL) {
        let _ = prev.destroy();
    }

    let parsed = url.parse().map_err(|_| format!("bad render url: {url}"))?;
    let app_for_load = app.clone();

    WebviewWindowBuilder::new(app, CAPTURE_LABEL, WebviewUrl::External(parsed))
        .title("")
        .inner_size(CAPTURE_W, CAPTURE_H)
        // Off-screen but on a real display so the webview actually renders.
        .position(-8000.0, -8000.0)
        .visible(true)
        .focused(false)
        .skip_taskbar(true)
        .decorations(false)
        .on_page_load(move |_webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let app = app_for_load.clone();
            let tx = tx.clone();
            // Let the canvas paint, then snapshot back on the UI thread.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(SETTLE_MS));
                let app_snap = app.clone();
                let tx_snap = tx.clone();
                let _ = app.clone().run_on_main_thread(move || {
                    snapshot(&app_snap, tx_snap);
                });
            });
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Snapshot the capture window's webview to PNG and send it. Runs on the UI
/// thread; `takeSnapshot`'s completion handler fires later on the same run loop.
fn snapshot(app: &AppHandle, tx: mpsc::Sender<Result<Vec<u8>, String>>) {
    let Some(window) = app.get_webview_window(CAPTURE_LABEL) else {
        let _ = tx.send(Err("capture window vanished before snapshot".into()));
        return;
    };

    #[cfg(target_os = "macos")]
    {
        let tx_inner = tx.clone();
        let dispatched = window.with_webview(move |webview| unsafe {
            macos::take_snapshot(webview.inner() as *mut objc2::runtime::AnyObject, tx_inner);
        });
        if let Err(e) = dispatched {
            let _ = tx.send(Err(format!("with_webview failed: {e}")));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        let _ = tx.send(Err("thumbnail capture is only implemented on macOS".into()));
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    // NSBitmapImageFileType::PNG.
    const NS_PNG_FILE_TYPE: u64 = 4;

    /// `wk` is the `WKWebView`. Calls `takeSnapshotWithConfiguration:nil
    /// completionHandler:`, converts the returned `NSImage` to PNG bytes in the
    /// handler, and sends the result.
    pub unsafe fn take_snapshot(wk: *mut AnyObject, tx: mpsc::Sender<Result<Vec<u8>, String>>) {
        if wk.is_null() {
            let _ = tx.send(Err("null WKWebView".into()));
            return;
        }

        let handler = RcBlock::new(move |image: *mut AnyObject, error: *mut AnyObject| {
            if !error.is_null() {
                let _ = tx.send(Err("WKWebView takeSnapshot reported an error".into()));
                return;
            }
            match png_from_nsimage(image) {
                Some(bytes) => {
                    let _ = tx.send(Ok(bytes));
                }
                None => {
                    let _ = tx.send(Err("could not encode snapshot to PNG".into()));
                }
            }
        });

        let config: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![wk, takeSnapshotWithConfiguration: config, completionHandler: &*handler];
    }

    /// `NSImage` → TIFF → `NSBitmapImageRep` → PNG `NSData` → `Vec<u8>`.
    unsafe fn png_from_nsimage(image: *mut AnyObject) -> Option<Vec<u8>> {
        if image.is_null() {
            return None;
        }
        let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
        if tiff.is_null() {
            return None;
        }
        let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        if rep.is_null() {
            return None;
        }
        let props: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        let png: *mut AnyObject =
            msg_send![rep, representationUsingType: NS_PNG_FILE_TYPE, properties: props];
        if png.is_null() {
            return None;
        }
        let len: usize = msg_send![png, length];
        let bytes: *const u8 = msg_send![png, bytes];
        if bytes.is_null() || len == 0 {
            return None;
        }
        Some(std::slice::from_raw_parts(bytes, len).to_vec())
    }
}
