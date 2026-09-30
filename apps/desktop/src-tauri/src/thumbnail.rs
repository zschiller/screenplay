//! The localhost control server the Node sidecar calls for shell services.
//!
//! The sidecar can't run a headless Chromium, so its `TauriWebviewCapturer`
//! POSTs `{ renderUrl }` to `/thumbnail` and expects PNG bytes back; the shell
//! renders the page in a webview and screenshots it. `/evaluate` renders the
//! same way but runs a script in the page instead and answers with the string
//! it resolves to (an agent reading a frame's HTML, #1268). It also can't open OS
//! dialogs, so `/pick-directory` opens a native folder picker (see `dialog`).
//! The server binds its own ephemeral port (passed to the sidecar as
//! `TAURI_CONTROL_URL`) so it never collides with the app's port.

use std::error::Error;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Method, Response, Server};

/// Label of the single off-screen window the preview URLs load into for
/// screenshotting. Built once on the first capture and reused for every
/// subsequent one via `navigate()` — see `capture` for why reuse matters.
const CAPTURE_LABEL: &str = "thumbnail-capture";
/// Monotonic id stamped on each capture. The persistent window's page-load
/// handler carries it so a stale load (a late redirect from a prior capture)
/// can be recognised and dropped rather than snapshotting into the wrong — or
/// an already-dropped — receiver.
static CAPTURE_GEN: AtomicU64 = AtomicU64::new(0);

/// The in-flight capture's result channel, keyed by its generation, and the
/// script to run instead of snapshotting, for an `/evaluate`. The control
/// server handles requests serially, so at most one capture is ever registered;
/// the generation guards only against a stray page-load event outliving it.
struct PendingCapture {
    generation: u64,
    tx: mpsc::Sender<Result<Vec<u8>, String>>,
    script: Option<String>,
}
static PENDING: Mutex<Option<PendingCapture>> = Mutex::new(None);
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
    /// For `/evaluate`: the body of an async function to run in the page.
    #[serde(default)]
    script: Option<String>,
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
/// /thumbnail`, `POST /evaluate` and `POST /pick-directory`. Its lifetime is tied to the
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

        let evaluate = request.url().starts_with("/evaluate");
        if !evaluate && !request.url().starts_with("/thumbnail") {
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
        let script = if evaluate {
            match parsed.script {
                Some(script) => Some(script),
                None => {
                    let _ = request
                        .respond(Response::from_string("missing script").with_status_code(400));
                    continue;
                }
            }
        } else {
            None
        };

        match capture(app, &parsed.render_url, width, height, script) {
            Ok(bytes) => {
                let content_type: &[u8] = if evaluate {
                    b"text/plain; charset=utf-8"
                } else {
                    b"image/png"
                };
                let header = Header::from_bytes(&b"Content-Type"[..], content_type).unwrap();
                let _ = request.respond(Response::from_data(bytes).with_header(header));
            }
            Err(e) => {
                eprintln!("[thumbnail] {} failed: {e}", if evaluate { "evaluate" } else { "capture" });
                let _ = request.respond(Response::from_string(e).with_status_code(500));
            }
        }
    }
}

/// Render `render_url` in the off-screen capture webview and return a PNG, or,
/// with a `script`, the UTF-8 string that script resolved to in the page.
///
/// Tauri v2 has no portable screenshot API (the one piece spike #407 left open),
/// so this drives the underlying WKWebView's `takeSnapshot` on macOS.
///
/// The window is built once and **reused** across captures via `navigate()`.
/// That reuse is what keeps focus from flickering: `wry` calls
/// `NSApplication.activate` when it *injects* a WKWebView, so building a fresh
/// window per capture yanked our app to the foreground every time (the old
/// record-frontmost / re-activate dance only restored it *after* an unavoidable
/// activate→deactivate cycle — the visible title-bar flicker). Navigating an
/// existing webview creates no new WKWebView, so it never activates anything.
///
/// On any failure the capturer surfaces it and `captureRoomThumbnail`'s caller
/// swallows it — a Room just shows no thumbnail.
fn capture(
    app: &AppHandle,
    render_url: &str,
    width: f64,
    height: f64,
    script: Option<String>,
) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let generation = CAPTURE_GEN.fetch_add(1, Ordering::Relaxed);

    // Register before navigating so the window's page-load handler can route
    // the resulting snapshot back to us.
    *PENDING.lock().unwrap() = Some(PendingCapture {
        generation,
        tx,
        script,
    });

    // Window + webview work must run on the UI thread.
    let app_main = app.clone();
    let url = render_url.to_string();
    if let Err(e) = app.run_on_main_thread(move || {
        if let Err(e) = ensure_window_and_navigate(&app_main, &url, width, height) {
            fail_capture(generation, e);
        }
    }) {
        // Couldn't even reach the UI thread — drop our registration.
        clear_pending(generation);
        return Err(e.to_string());
    }

    let result = rx
        .recv_timeout(Duration::from_secs(CAPTURE_TIMEOUT_S))
        .unwrap_or_else(|_| Err("thumbnail capture timed out".into()));

    // Invalidate this generation so a late load event can't snapshot into the
    // now-dropped receiver.
    clear_pending(generation);
    result
}

/// Drop the pending registration if it's still `generation` (a no-op once a
/// snapshot or a newer capture has claimed it).
fn clear_pending(generation: u64) {
    let mut pending = PENDING.lock().unwrap();
    if matches!(pending.as_ref(), Some(p) if p.generation == generation) {
        *pending = None;
    }
}

/// Fail the pending capture `generation` with `err`, if it's still current.
fn fail_capture(generation: u64, err: String) {
    let mut pending = PENDING.lock().unwrap();
    if matches!(pending.as_ref(), Some(p) if p.generation == generation) {
        if let Some(p) = pending.take() {
            let _ = p.tx.send(Err(err));
        }
    }
}

/// Resize the persistent capture window to the frame's size and navigate it to
/// `url`, building the window on first use. Runs on the UI thread.
fn ensure_window_and_navigate(
    app: &AppHandle,
    url: &str,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("bad render url: {url}"))?;

    if let Some(window) = app.get_webview_window(CAPTURE_LABEL) {
        // Reuse the existing webview: resize to the frame's size, then navigate.
        // No new WKWebView is created, so wry never re-activates our app — the
        // user's focus and the main window's title bar are left untouched.
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        // Re-assert the off-screen origin every capture: `set_size` (and the
        // window server) can nudge the frame back on-screen, and the reuse path
        // never re-runs the build-time hide. Without this, the window creeps
        // into view after the first thumbnail.
        #[cfg(target_os = "macos")]
        {
            let _ = window.with_webview(|webview| unsafe {
                macos::hide_offscreen(webview.inner() as *mut objc2::runtime::AnyObject);
            });
        }
        window.navigate(parsed).map_err(|e| e.to_string())
    } else {
        build_capture_window(app, parsed, width, height)
    }
}

/// Build the single off-screen capture window. Its page-load handler routes the
/// snapshot of whichever capture is registered when `load` fires (+ settle).
fn build_capture_window(
    app: &AppHandle,
    url: tauri::Url,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let app_for_load = app.clone();

    // Record whoever is frontmost *before* we build. `wry` calls
    // `NSApplication.activate` when it injects the WKWebview (wkwebview/mod.rs:
    // "make sure the window is always on top when we create a new webview") —
    // neither `visible(false)` nor `focused(false)` suppress it. We re-activate
    // the previous app below to undo it. This happens at most *once* per app
    // run, since every subsequent capture reuses this webview via `navigate()`.
    #[cfg(target_os = "macos")]
    let prev_app = unsafe { macos::frontmost_app() };

    let window = WebviewWindowBuilder::new(app, CAPTURE_LABEL, WebviewUrl::External(url))
        .title("")
        .inner_size(width, height)
        // Off-screen but on a real display so the webview actually renders.
        .position(-8000.0, -8000.0)
        // Built hidden: a window made visible at build time gets
        // `makeKeyAndOrderFront` on macOS, which yanks the app to the
        // foreground. We order it on screen ourselves below without activating.
        // `focused(false)` alone doesn't prevent this.
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .decorations(false)
        .on_page_load(move |_webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            // Whichever capture is registered now owns this load; carry its
            // generation so a stale load (a prior capture's late redirect)
            // can be dropped at snapshot time.
            let generation = match PENDING.lock().unwrap().as_ref() {
                Some(p) => p.generation,
                None => return,
            };
            let app = app_for_load.clone();
            // Let the canvas paint, then snapshot back on the UI thread.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(SETTLE_MS));
                let app_snap = app.clone();
                let _ = app.run_on_main_thread(move || {
                    snapshot_if_current(&app_snap, generation);
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

/// Snapshot the capture window's webview to PNG and send it to the capture that
/// owns `generation`. Claims the pending registration (taking its sender) so a
/// duplicate load event can't snapshot twice; a generation mismatch means a
/// newer capture superseded this one, so the stale load is dropped. Runs on the
/// UI thread; `takeSnapshot`'s completion handler fires later on the same loop.
fn snapshot_if_current(app: &AppHandle, generation: u64) {
    let claimed = {
        let mut pending = PENDING.lock().unwrap();
        match pending.as_ref() {
            Some(p) if p.generation == generation => pending.take(),
            _ => None,
        }
    };
    let Some(PendingCapture { tx, script, .. }) = claimed else { return };

    let Some(window) = app.get_webview_window(CAPTURE_LABEL) else {
        let _ = tx.send(Err("capture window vanished before snapshot".into()));
        return;
    };

    #[cfg(target_os = "macos")]
    {
        let tx_inner = tx.clone();
        let dispatched = window.with_webview(move |webview| unsafe {
            let wk = webview.inner() as *mut objc2::runtime::AnyObject;
            match script {
                Some(script) => macos::run_script(wk, &script, tx_inner),
                None => macos::take_snapshot(wk, tx_inner),
            }
        });
        if let Err(e) = dispatched {
            let _ = tx.send(Err(format!("with_webview failed: {e}")));
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, script);
        let _ = tx.send(Err("thumbnail capture is only implemented on macOS".into()));
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, CStr, CString};
    use std::sync::mpsc;

    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    // NSBitmapImageFileType::PNG.
    const NS_PNG_FILE_TYPE: u64 = 4;

    /// Matches `CGPoint` / `NSPoint` layout for `setFrameOrigin:`.
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    unsafe impl objc2::Encode for CGPoint {
        const ENCODING: objc2::Encoding =
            objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }

    /// Matches `CGSize` / `NSSize` layout.
    #[repr(C)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    unsafe impl objc2::Encode for CGSize {
        const ENCODING: objc2::Encoding =
            objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }

    /// Matches `CGRect` / `NSRect` layout, returned by `-[NSWindow frame]`.
    #[repr(C)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    unsafe impl objc2::Encode for CGRect {
        const ENCODING: objc2::Encoding =
            objc2::Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
    }

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

    /// Make the webview's `NSWindow` invisible to the user while keeping it
    /// rendering, so `takeSnapshot` captures a fully painted page.
    ///
    /// Position alone is not enough: `decorations(false)` still yields a
    /// constrained window on recent macOS, so `constrainFrameRect:toScreen:`
    /// clamps a far-off-screen origin back near a display edge — the window
    /// reappears. `alphaValue = 0` sidesteps the window server entirely: the
    /// frame stays geometrically on-screen and un-occluded (so the WKWebView
    /// keeps rendering and snapshots fine), but nothing composites to the
    /// display. We still push the origin off-screen as a best-effort second
    /// line of defence for when the platform *does* honour it.
    pub unsafe fn hide_offscreen(wk: *mut AnyObject) {
        if wk.is_null() {
            return;
        }
        let window: *mut AnyObject = msg_send![wk, window];
        if window.is_null() {
            return;
        }
        // Primary hide: fully transparent, so it's invisible wherever macOS
        // parks the frame.
        let _: () = msg_send![window, setAlphaValue: 0.0f64];
        // Secondary hide: Cocoa screen coords are bottom-left origin, Y up; a
        // large negative origin puts the window off every display when honoured.
        let origin = CGPoint {
            x: -10_000.0,
            y: -10_000.0,
        };
        let _: () = msg_send![window, setFrameOrigin: origin];
        // Ground-truth log: shows where the frame actually landed (deeply
        // negative = off-screen honoured; near 0 = constrained back on-screen,
        // in which case the alpha is what's keeping it invisible).
        let frame: CGRect = msg_send![window, frame];
        let alpha: f64 = msg_send![window, alphaValue];
        eprintln!(
            "[thumbnail] capture window after hide: x={} y={} w={} h={} alpha={}",
            frame.origin.x, frame.origin.y, frame.size.width, frame.size.height, alpha
        );
    }

    /// Order the capture window on screen behind everything in its level without
    /// making it key or activating the app. Used instead of building the window
    /// `visible(true)`, which would `makeKeyAndOrderFront` and steal the user's
    /// focus on every thumbnail. Repositions off-screen first so back-ordering
    /// it is invisible to the user.
    pub unsafe fn show_without_activating(wk: *mut AnyObject) {
        if wk.is_null() {
            return;
        }
        hide_offscreen(wk);
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

    /// `wk` is the `WKWebView`. Runs `script` as the body of an async function
    /// in the page's own world via `callAsyncJavaScript` (which, unlike
    /// `evaluateJavaScript`, waits for a returned promise), and sends the
    /// string it resolves to.
    pub unsafe fn run_script(
        wk: *mut AnyObject,
        script: &str,
        tx: mpsc::Sender<Result<Vec<u8>, String>>,
    ) {
        if wk.is_null() {
            let _ = tx.send(Err("null WKWebView".into()));
            return;
        }
        let Ok(body) = CString::new(script) else {
            let _ = tx.send(Err("script contains a NUL byte".into()));
            return;
        };
        let body: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: body.as_ptr()];
        let arguments: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        let world: *mut AnyObject = msg_send![class!(WKContentWorld), pageWorld];
        let main_frame: *mut AnyObject = std::ptr::null_mut();

        let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
            if !error.is_null() {
                let description: *mut AnyObject = msg_send![error, localizedDescription];
                let message = ns_string(description)
                    .unwrap_or_else(|| "the script failed in the page".into());
                let _ = tx.send(Err(message));
                return;
            }
            match ns_string(result) {
                Some(text) => {
                    let _ = tx.send(Ok(text.into_bytes()));
                }
                None => {
                    let _ = tx.send(Err("the script didn't resolve to a string".into()));
                }
            }
        });

        let _: () = msg_send![
            wk,
            callAsyncJavaScript: body,
            arguments: arguments,
            inFrame: main_frame,
            inContentWorld: world,
            completionHandler: &*handler
        ];
    }

    /// An `NSString`'s text, or `None` for nil or any other kind of object.
    unsafe fn ns_string(obj: *mut AnyObject) -> Option<String> {
        if obj.is_null() {
            return None;
        }
        let is_string: bool = msg_send![obj, isKindOfClass: class!(NSString)];
        if !is_string {
            return None;
        }
        let utf8: *const c_char = msg_send![obj, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
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
