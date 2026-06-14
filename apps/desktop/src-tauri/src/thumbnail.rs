//! The localhost control server the Node sidecar calls for shell services.
//!
//! The sidecar can't run a headless Chromium, so its `TauriWebviewCapturer`
//! POSTs `{ renderUrl }` to `/thumbnail` and expects PNG bytes back; the shell
//! renders the page in a webview and screenshots it. It also can't open OS
//! dialogs, so `/pick-directory` opens a native folder picker (see `dialog`).
//! The server binds its own ephemeral port (passed to the sidecar as
//! `TAURI_CONTROL_URL`) so it never collides with the app's port.

use std::error::Error;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Method, Response, Server};

/// Label prefix for the off-screen window the preview URL loads into for
/// screenshotting. Each capture builds its own uniquely-suffixed window rather
/// than reusing one label: `destroy()` dispatched from the worker thread (the
/// teardown in `capture`) completes asynchronously on the event loop, so the
/// previous capture's window can still be registered under its label when the
/// next request — the control server handles them serially — goes to build.
/// Reusing a fixed label then fails with "a webview with label X already
/// exists"; a fresh label per capture sidesteps that race entirely.
const CAPTURE_LABEL_PREFIX: &str = "thumbnail-capture";
/// Monotonic counter making each capture window's label unique.
static CAPTURE_SEQ: AtomicU64 = AtomicU64::new(0);
/// Fallback viewport, used only when the sidecar sends no usable width/height
/// (an older sidecar, or a degenerate frame). The real capture size is the
/// frame's own width/height — sent per request by `TauriWebviewCapturer` and
/// matching exactly what the canvas renders the iframe at — so the screenshot
/// shares the frame's aspect ratio rather than being cropped to a fixed box.
/// Downstream `sharp` resizes the result to the stored thumbnail size.
const DEFAULT_CAPTURE_W: f64 = 1280.0;
const DEFAULT_CAPTURE_H: f64 = 960.0;
/// Settle delay after the page's `load` before snapshotting, to let the
/// preview paint before the screenshot (a fixed budget since a remote page
/// can't signal the shell back over IPC).
const SETTLE_MS: u64 = 1_500;
const CAPTURE_TIMEOUT_S: u64 = 25;

#[derive(Deserialize)]
struct ThumbnailRequest {
    #[serde(rename = "renderUrl")]
    render_url: String,
    /// The frame's own width/height (CSS px), sent so the off-screen webview
    /// renders the page at the same size the canvas does. Optional so an older
    /// sidecar that omits them still captures (at the fallback box).
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
}

impl ThumbnailRequest {
    /// The capture viewport: the frame's own size when usable, else the
    /// fallback. A non-positive or absent dimension falls back per-axis.
    fn capture_size(&self) -> (f64, f64) {
        let w = self.width.filter(|w| *w >= 1.0).unwrap_or(DEFAULT_CAPTURE_W);
        let h = self
            .height
            .filter(|h| *h >= 1.0)
            .unwrap_or(DEFAULT_CAPTURE_H);
        (w, h)
    }
}

/// A tiny HTTP server bound to a localhost ephemeral port, serving `POST
/// /thumbnail` and `POST /pick-directory`. Its lifetime is tied to the
/// sidecar's (started in `sidecar::launch`, stopped in `Sidecar::shutdown`).
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
        if request.method() != &Method::Post {
            let _ = request.respond(Response::from_string("not found").with_status_code(404));
            continue;
        }

        // Native folder picker for the add-Repo local-folder flow (#428): the
        // sidecar has no OS dialogs of its own, so it borrows the shell's.
        if request.url().starts_with("/pick-directory") {
            let body = serde_json::json!({ "path": crate::dialog::pick_directory(app) });
            let header =
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            let _ = request.respond(Response::from_string(body.to_string()).with_header(header));
            continue;
        }

        if !request.url().starts_with("/thumbnail") {
            let _ = request.respond(Response::from_string("not found").with_status_code(404));
            continue;
        }

        let mut body = String::new();
        if request.as_reader().read_to_string(&mut body).is_err() {
            let _ = request.respond(Response::from_string("bad body").with_status_code(400));
            continue;
        }

        let parsed = match serde_json::from_str::<ThumbnailRequest>(&body) {
            Ok(parsed) => parsed,
            Err(_) => {
                let _ =
                    request.respond(Response::from_string("bad json").with_status_code(400));
                continue;
            }
        };
        let (width, height) = parsed.capture_size();

        match capture(app, &parsed.render_url, width, height) {
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
fn capture(app: &AppHandle, render_url: &str, width: f64, height: f64) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    // A fresh label per capture — see `CAPTURE_LABEL_PREFIX`.
    let label = format!(
        "{CAPTURE_LABEL_PREFIX}-{}",
        CAPTURE_SEQ.fetch_add(1, Ordering::Relaxed)
    );

    // Window + webview work must run on the UI thread.
    let app_main = app.clone();
    let url = render_url.to_string();
    let tx_build = tx.clone();
    let label_build = label.clone();
    app.run_on_main_thread(move || {
        if let Err(e) =
            open_capture_window(&app_main, &url, &label_build, width, height, tx_build.clone())
        {
            let _ = tx_build.send(Err(e));
        }
    })
    .map_err(|e| e.to_string())?;

    let result = rx
        .recv_timeout(Duration::from_secs(CAPTURE_TIMEOUT_S))
        .unwrap_or_else(|_| Err("thumbnail capture timed out".into()));

    // Tear the off-screen window down regardless of outcome. Dispatched async
    // from this worker thread; the unique label keeps the next capture from
    // colliding with it before it lands.
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.destroy();
    }
    result
}

/// Build the off-screen capture window; on page `load` (+ settle), snapshot it.
fn open_capture_window(
    app: &AppHandle,
    url: &str,
    label: &str,
    width: f64,
    height: f64,
    tx: mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    let parsed = url.parse().map_err(|_| format!("bad render url: {url}"))?;
    let app_for_load = app.clone();
    let label_load = label.to_string();

    // Record whoever is frontmost *before* we build the window. `wry` calls
    // `NSApplication.activate` unconditionally when it injects the WKWebview
    // (wkwebview/mod.rs: "make sure the window is always on top when we create
    // a new webview") — neither `visible(false)` nor `focused(false)` suppress
    // it, so every capture yanks our app to the foreground. We re-activate the
    // previous app below to undo that.
    #[cfg(target_os = "macos")]
    let prev_app = unsafe { macos::frontmost_app() };

    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title("")
        .inner_size(width, height)
        // Off-screen but on a real display so the webview actually renders.
        .position(-8000.0, -8000.0)
        // Built hidden: a window made visible at build time gets
        // `makeKeyAndOrderFront` on macOS, which yanks the app to the
        // foreground every capture. We order it on screen ourselves below
        // without activating. `focused(false)` alone doesn't prevent this.
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .decorations(false)
        .on_page_load(move |_webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let app = app_for_load.clone();
            let tx = tx.clone();
            let label = label_load.clone();
            // Let the canvas paint, then snapshot back on the UI thread.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(SETTLE_MS));
                let app_snap = app.clone();
                let tx_snap = tx.clone();
                let label_snap = label.clone();
                let _ = app.clone().run_on_main_thread(move || {
                    snapshot(&app_snap, &label_snap, tx_snap);
                });
            });
        })
        .build()
        .map_err(|e| e.to_string())?;

    // Make the off-screen webview visible enough to render, without stealing
    // focus. `orderBack:` puts the window on screen behind everything in its
    // level and never makes it key or activates the app, so the page paints
    // (the snapshot needs a rendered webview) but the user's focus is left
    // alone. The window is positioned off any display, so back-ordering it is
    // invisible to the user.
    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(|webview| unsafe {
            macos::show_without_activating(webview.inner() as *mut objc2::runtime::AnyObject);
        });
        // Hand the foreground back to whoever had it before `wry` activated us.
        // No-op (and harmless) if our app was already frontmost.
        unsafe { macos::reactivate_app(prev_app) };
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.show();
    }
    Ok(())
}

/// Snapshot the capture window's webview to PNG and send it. Runs on the UI
/// thread; `takeSnapshot`'s completion handler fires later on the same run loop.
fn snapshot(app: &AppHandle, label: &str, tx: mpsc::Sender<Result<Vec<u8>, String>>) {
    let Some(window) = app.get_webview_window(label) else {
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

    /// The app that is currently frontmost, retained so it stays valid across
    /// the capture-window build. Returns null if there is none. Pair every
    /// non-null return with a `reactivate_app` call, which releases it.
    pub unsafe fn frontmost_app() -> *mut AnyObject {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return std::ptr::null_mut();
        }
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return std::ptr::null_mut();
        }
        // `frontmostApplication` is autoreleased; retain it past the autorelease
        // pool so it survives until we re-activate it.
        let _: *mut AnyObject = msg_send![app, retain];
        app
    }

    /// Re-activate `app` (an `NSRunningApplication`), restoring the foreground to
    /// whoever held it before `wry` activated us. Releases the retain taken by
    /// `frontmost_app`. No-op on null.
    pub unsafe fn reactivate_app(app: *mut AnyObject) {
        if app.is_null() {
            return;
        }
        // Options 0 = default activation (don't force-raise every window).
        let _: bool = msg_send![app, activateWithOptions: 0u64];
        let _: () = msg_send![app, release];
    }

    /// Order the webview's `NSWindow` on screen behind everything in its level
    /// without making it key or activating the app. Used instead of building
    /// the capture window `visible(true)`, which would `makeKeyAndOrderFront`
    /// and steal the user's focus on every thumbnail.
    pub unsafe fn show_without_activating(wk: *mut AnyObject) {
        if wk.is_null() {
            return;
        }
        let window: *mut AnyObject = msg_send![wk, window];
        if window.is_null() {
            return;
        }
        let nil: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![window, orderBack: nil];
    }

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
