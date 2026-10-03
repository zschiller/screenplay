//! Real input for the agent driving a frame on the canvas (#1385).
//!
//! The sidecar's Frame Drive backend (`apps/app/lib/frame-drive/mac/`) POSTs
//! here to play a gesture the frame's Sandbox Bridge can only fake: mouse and
//! key events for the main window's web view, the person's clipboard set aside
//! around a gesture that may copy or paste, and Workspace files for a file
//! picker the agent's click opens.
//!
//! Events go straight to the `WKWebView`'s responder methods (`mouseDown:`,
//! `keyDown:`, ...), never through `CGEventPost` or `-[NSWindow sendEvent:]`:
//! the person's pointer doesn't move, the window doesn't come forward, and
//! Screenplay doesn't activate. WebKit takes them as real (trusted) input.

// Only the macOS shell reads the requests.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// One request, by `action`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum DriveInputRequest {
    /// Deliver `events` to the main window's web view, in order.
    Events { events: Vec<NativeEvent> },
    /// Set the person's clipboard aside, with `text` on it meanwhile.
    HoldClipboard { text: Option<String> },
    /// Put the person's clipboard back; answers what the gesture copied.
    ReleaseClipboard,
    /// Answer the next file picker the main window opens with these files.
    OfferFiles { paths: Vec<String> },
    /// Stop offering them; answers whether a picker took them.
    WithdrawFiles,
}

/// One event, at a point in the web view (CSS px, top-left origin).
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum NativeEvent {
    Move {
        x: f64,
        y: f64,
    },
    Down {
        x: f64,
        y: f64,
        #[serde(rename = "clickCount")]
        click_count: i64,
    },
    Up {
        x: f64,
        y: f64,
        #[serde(rename = "clickCount")]
        click_count: i64,
    },
    /// A key named as in `KeyboardEvent.key`; `text` is what it types.
    Key {
        key: String,
        text: Option<String>,
        #[serde(default)]
        modifiers: Modifiers,
    },
    /// An editing command, as the Edit menu runs it.
    Edit {
        action: EditAction,
    },
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Modifiers {
    #[serde(default)]
    shift_key: bool,
    #[serde(default)]
    ctrl_key: bool,
    #[serde(default)]
    alt_key: bool,
    #[serde(default)]
    meta_key: bool,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum EditAction {
    Copy,
    Cut,
    Paste,
    SelectAll,
}

#[derive(Serialize, Default)]
pub struct DriveInputAnswer {
    #[serde(skip_serializing_if = "Option::is_none")]
    copied: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    taken: Option<bool>,
}

/// Run one request on the main thread, where AppKit lives.
pub fn handle(app: &AppHandle, request: DriveInputRequest) -> Result<DriveInputAnswer, String> {
    let (tx, rx) = mpsc::channel::<Result<DriveInputAnswer, String>>();
    let app_main = app.clone();
    app.run_on_main_thread(move || {
        let Some(window) = app_main.get_webview_window("main") else {
            let _ = tx.send(Err("no main window".into()));
            return;
        };
        #[cfg(target_os = "macos")]
        {
            let tx_inner = tx.clone();
            let dispatched = window.with_webview(move |webview| unsafe {
                let wk = webview.inner() as *mut objc2::runtime::AnyObject;
                let _ = tx_inner.send(macos::run(wk, request));
            });
            if let Err(e) = dispatched {
                let _ = tx.send(Err(format!("with_webview failed: {e}")));
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (window, request);
            let _ = tx.send(Err("real input is only implemented on macOS".into()));
        }
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10))
        .unwrap_or_else(|_| Err("the input timed out".into()))
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, CStr, CString};
    use std::sync::{Mutex, Once, OnceLock};

    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};

    use super::{DriveInputAnswer, DriveInputRequest, EditAction, Modifiers, NativeEvent};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    unsafe impl objc2::Encode for CGPoint {
        const ENCODING: objc2::Encoding =
            objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    unsafe impl objc2::Encode for CGSize {
        const ENCODING: objc2::Encoding =
            objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    unsafe impl objc2::Encode for CGRect {
        const ENCODING: objc2::Encoding =
            objc2::Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
    }

    // NSEventType.
    const LEFT_MOUSE_DOWN: u64 = 1;
    const LEFT_MOUSE_UP: u64 = 2;
    const MOUSE_MOVED: u64 = 5;
    const KEY_DOWN: u64 = 10;
    const KEY_UP: u64 = 11;
    // NSEventModifierFlags.
    const SHIFT: u64 = 1 << 17;
    const CONTROL: u64 = 1 << 18;
    const OPTION: u64 = 1 << 19;
    const COMMAND: u64 = 1 << 20;

    const PLAIN_TEXT: &str = "public.utf8-plain-text";

    /// The person's clipboard while a gesture holds it: each item's data by
    /// type, and the change count once the hold put the agent's text there.
    struct Held {
        items: Vec<Vec<(String, Vec<u8>)>>,
        change_count: i64,
        replaced: bool,
    }

    static HELD: Mutex<Option<Held>> = Mutex::new(None);

    /// The files offered to the next file picker, and whether one took them.
    struct Offer {
        paths: Vec<String>,
        taken: bool,
    }

    static OFFER: Mutex<Option<Offer>> = Mutex::new(None);

    pub unsafe fn run(
        wk: *mut AnyObject,
        request: DriveInputRequest,
    ) -> Result<DriveInputAnswer, String> {
        if wk.is_null() {
            return Err("null WKWebView".into());
        }
        match request {
            DriveInputRequest::Events { events } => {
                for event in events {
                    deliver(wk, event)?;
                }
                Ok(DriveInputAnswer::default())
            }
            DriveInputRequest::HoldClipboard { text } => {
                hold_clipboard(text);
                Ok(DriveInputAnswer::default())
            }
            DriveInputRequest::ReleaseClipboard => Ok(DriveInputAnswer {
                copied: Some(release_clipboard()),
                ..Default::default()
            }),
            DriveInputRequest::OfferFiles { paths } => {
                intercept_open_panel(wk)?;
                *OFFER.lock().unwrap() = Some(Offer {
                    paths,
                    taken: false,
                });
                Ok(DriveInputAnswer::default())
            }
            DriveInputRequest::WithdrawFiles => {
                let offer = OFFER.lock().unwrap().take();
                Ok(DriveInputAnswer {
                    taken: Some(offer.is_some_and(|o| o.taken)),
                    ..Default::default()
                })
            }
        }
    }

    // ---------- events ----------

    unsafe fn deliver(wk: *mut AnyObject, event: NativeEvent) -> Result<(), String> {
        let window: *mut AnyObject = msg_send![wk, window];
        if window.is_null() {
            return Err("the web view has no window".into());
        }
        let number: isize = msg_send![window, windowNumber];
        let time: f64 = {
            let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
            msg_send![info, systemUptime]
        };
        let nil: *mut AnyObject = std::ptr::null_mut();
        match event {
            NativeEvent::Move { x, y } => {
                let ev = mouse_event(MOUSE_MOVED, window_point(wk, x, y), number, time, 0)?;
                let _: () = msg_send![wk, mouseMoved: ev];
            }
            NativeEvent::Down { x, y, click_count } => {
                let ev = mouse_event(
                    LEFT_MOUSE_DOWN,
                    window_point(wk, x, y),
                    number,
                    time,
                    click_count,
                )?;
                let _: () = msg_send![wk, mouseDown: ev];
            }
            NativeEvent::Up { x, y, click_count } => {
                let ev = mouse_event(
                    LEFT_MOUSE_UP,
                    window_point(wk, x, y),
                    number,
                    time,
                    click_count,
                )?;
                let _: () = msg_send![wk, mouseUp: ev];
            }
            NativeEvent::Key {
                key,
                text,
                modifiers,
            } => {
                let (code, special) = key_code(&key);
                let flags = modifier_flags(modifiers);
                let chars = special
                    .map(|c| c.to_string())
                    .or(text.clone())
                    .unwrap_or_else(|| key.clone());
                let unmodified = special
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| key.to_lowercase());
                let down = key_event(KEY_DOWN, flags, number, time, &chars, &unmodified, code)?;
                let up = key_event(KEY_UP, flags, number, time, &chars, &unmodified, code)?;
                // A shortcut goes the way the system sends one, so the page
                // hears it before any menu would.
                if modifiers.meta_key {
                    let handled: bool = msg_send![wk, performKeyEquivalent: down];
                    if !handled {
                        let _: () = msg_send![wk, keyDown: down];
                    }
                } else {
                    let _: () = msg_send![wk, keyDown: down];
                }
                let _: () = msg_send![wk, keyUp: up];
            }
            NativeEvent::Edit { action } => {
                let sel = match action {
                    EditAction::Copy => sel!(copy:),
                    EditAction::Cut => sel!(cut:),
                    EditAction::Paste => sel!(paste:),
                    EditAction::SelectAll => sel!(selectAll:),
                };
                let responds: bool = msg_send![wk, respondsToSelector: sel];
                if !responds {
                    return Err("the web view can't run that editing command".into());
                }
                let _: *mut AnyObject = msg_send![wk, performSelector: sel, withObject: nil];
            }
        }
        Ok(())
    }

    /// A point in the web view (CSS px from its top left) in its window's
    /// coordinates (points from the bottom left).
    unsafe fn window_point(wk: *mut AnyObject, x: f64, y: f64) -> CGPoint {
        let flipped: bool = msg_send![wk, isFlipped];
        let bounds: CGRect = msg_send![wk, bounds];
        let local = CGPoint {
            x,
            y: if flipped { y } else { bounds.size.height - y },
        };
        let nil: *mut AnyObject = std::ptr::null_mut();
        msg_send![wk, convertPoint: local, toView: nil]
    }

    unsafe fn mouse_event(
        kind: u64,
        at: CGPoint,
        window_number: isize,
        time: f64,
        click_count: i64,
    ) -> Result<*mut AnyObject, String> {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let ev: *mut AnyObject = msg_send![
            class!(NSEvent),
            mouseEventWithType: kind,
            location: at,
            modifierFlags: 0u64,
            timestamp: time,
            windowNumber: window_number,
            context: nil,
            eventNumber: 0isize,
            clickCount: click_count as isize,
            pressure: if kind == LEFT_MOUSE_DOWN { 1.0f32 } else { 0.0f32 }
        ];
        if ev.is_null() {
            return Err("couldn't make a mouse event".into());
        }
        Ok(ev)
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn key_event(
        kind: u64,
        flags: u64,
        window_number: isize,
        time: f64,
        chars: &str,
        unmodified: &str,
        code: u16,
    ) -> Result<*mut AnyObject, String> {
        let nil: *mut AnyObject = std::ptr::null_mut();
        let chars = ns_string(chars)?;
        let unmodified = ns_string(unmodified)?;
        let ev: *mut AnyObject = msg_send![
            class!(NSEvent),
            keyEventWithType: kind,
            location: CGPoint { x: 0.0, y: 0.0 },
            modifierFlags: flags,
            timestamp: time,
            windowNumber: window_number,
            context: nil,
            characters: chars,
            charactersIgnoringModifiers: unmodified,
            isARepeat: false,
            keyCode: code
        ];
        if ev.is_null() {
            return Err("couldn't make a key event".into());
        }
        Ok(ev)
    }

    fn modifier_flags(m: Modifiers) -> u64 {
        (if m.shift_key { SHIFT } else { 0 })
            | (if m.ctrl_key { CONTROL } else { 0 })
            | (if m.alt_key { OPTION } else { 0 })
            | (if m.meta_key { COMMAND } else { 0 })
    }

    /// The Mac virtual key codes of the keys that type a character.
    #[rustfmt::skip]
    const ANSI_KEYS: [(char, u16); 47] = [
        ('a', 0), ('s', 1), ('d', 2), ('f', 3), ('h', 4), ('g', 5), ('z', 6),
        ('x', 7), ('c', 8), ('v', 9), ('b', 11), ('q', 12), ('w', 13), ('e', 14),
        ('r', 15), ('y', 16), ('t', 17), ('1', 18), ('2', 19), ('3', 20), ('4', 21),
        ('6', 22), ('5', 23), ('=', 24), ('9', 25), ('7', 26), ('-', 27), ('8', 28),
        ('0', 29), (']', 30), ('o', 31), ('u', 32), ('[', 33), ('i', 34), ('p', 35),
        ('l', 37), ('j', 38), ('\'', 39), ('k', 40), (';', 41), ('\\', 42), (',', 43),
        ('/', 44), ('n', 45), ('m', 46), ('.', 47), ('`', 50),
    ];

    /// The Mac virtual key code for a key named as in `KeyboardEvent.key`,
    /// and the character AppKit gives a key that types none of its own.
    fn key_code(key: &str) -> (u16, Option<char>) {
        let named = match key {
            "Enter" => Some((36, '\r')),
            "Tab" => Some((48, '\t')),
            " " => Some((49, ' ')),
            "Backspace" => Some((51, '\u{7f}')),
            "Escape" => Some((53, '\u{1b}')),
            "Delete" => Some((117, '\u{f728}')),
            "ArrowLeft" => Some((123, '\u{f702}')),
            "ArrowRight" => Some((124, '\u{f703}')),
            "ArrowDown" => Some((125, '\u{f701}')),
            "ArrowUp" => Some((126, '\u{f700}')),
            "Home" => Some((115, '\u{f729}')),
            "End" => Some((119, '\u{f72b}')),
            "PageUp" => Some((116, '\u{f72c}')),
            "PageDown" => Some((121, '\u{f72d}')),
            _ => None,
        };
        if let Some((code, ch)) = named {
            return (code, Some(ch));
        }
        if let Some(n) = key.strip_prefix('F').and_then(|n| n.parse::<usize>().ok()) {
            const F: [u16; 12] = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111];
            if (1..=12).contains(&n) {
                let ch = char::from_u32(0xf704 + n as u32 - 1);
                return (F[n - 1], ch);
            }
        }
        let mut chars = key.chars();
        let (Some(c), None) = (chars.next(), chars.next()) else {
            return (0, None);
        };
        // ANSI layout positions; any other character types through its text.
        let lower = c.to_ascii_lowercase();
        let code = ANSI_KEYS
            .iter()
            .find(|(ch, _)| *ch == lower)
            .map_or(0, |(_, code)| *code);
        (code, None)
    }

    // ---------- clipboard ----------

    unsafe fn general_pasteboard() -> *mut AnyObject {
        msg_send![class!(NSPasteboard), generalPasteboard]
    }

    /// Keep every item of the person's clipboard, every type of it, so it
    /// goes back exactly as it was.
    unsafe fn hold_clipboard(text: Option<String>) {
        let pb = general_pasteboard();
        // A hold a gesture never released goes back first.
        if HELD.lock().unwrap().is_some() {
            release_clipboard();
        }
        let mut items = Vec::new();
        let list: *mut AnyObject = msg_send![pb, pasteboardItems];
        let count: usize = if list.is_null() {
            0
        } else {
            msg_send![list, count]
        };
        for i in 0..count {
            let item: *mut AnyObject = msg_send![list, objectAtIndex: i];
            let types: *mut AnyObject = msg_send![item, types];
            let type_count: usize = if types.is_null() {
                0
            } else {
                msg_send![types, count]
            };
            let mut kept = Vec::new();
            for t in 0..type_count {
                let kind: *mut AnyObject = msg_send![types, objectAtIndex: t];
                let data: *mut AnyObject = msg_send![item, dataForType: kind];
                if let (Some(kind), Some(bytes)) = (rust_string(kind), data_bytes(data)) {
                    kept.push((kind, bytes));
                }
            }
            items.push(kept);
        }
        let replaced = text.is_some();
        if let Some(text) = text {
            let _: isize = msg_send![pb, clearContents];
            if let (Ok(text), Ok(kind)) = (ns_string(&text), ns_string(PLAIN_TEXT)) {
                let _: bool = msg_send![pb, setString: text, forType: kind];
            }
        }
        let change_count: isize = msg_send![pb, changeCount];
        *HELD.lock().unwrap() = Some(Held {
            items,
            change_count: change_count as i64,
            replaced,
        });
    }

    /// Put the person's clipboard back. What the gesture copied, if it did.
    unsafe fn release_clipboard() -> Option<String> {
        let held = HELD.lock().unwrap().take()?;
        let pb = general_pasteboard();
        let now: isize = msg_send![pb, changeCount];
        let changed = now as i64 != held.change_count;
        let copied = match ns_string(PLAIN_TEXT) {
            Ok(kind) if changed => {
                let text: *mut AnyObject = msg_send![pb, stringForType: kind];
                rust_string(text)
            }
            _ => None,
        };
        if changed || held.replaced {
            let _: isize = msg_send![pb, clearContents];
            let objects: *mut AnyObject = msg_send![class!(NSMutableArray), array];
            for kept in held.items {
                let item: *mut AnyObject = msg_send![class!(NSPasteboardItem), new];
                for (kind, bytes) in kept {
                    let Ok(kind) = ns_string(&kind) else { continue };
                    let data: *mut AnyObject = msg_send![
                        class!(NSData),
                        dataWithBytes: bytes.as_ptr() as *const std::ffi::c_void,
                        length: bytes.len()
                    ];
                    let _: bool = msg_send![item, setData: data, forType: kind];
                }
                let _: () = msg_send![objects, addObject: item];
                let _: () = msg_send![item, release];
            }
            let _: bool = msg_send![pb, writeObjects: objects];
        }
        copied
    }

    // ---------- file pickers ----------

    type OpenPanelFn = unsafe extern "C-unwind" fn(
        *mut AnyObject,
        Sel,
        *mut AnyObject,
        *mut AnyObject,
        *mut AnyObject,
        *mut block2::Block<dyn Fn(*const AnyObject)>,
    );

    /// wry's own open-panel handler, which shows the Finder panel.
    static ORIGINAL_OPEN_PANEL: OnceLock<Option<OpenPanelFn>> = OnceLock::new();
    static INTERCEPT: Once = Once::new();

    /// Answer the web view's file pickers here first: with the offered files
    /// while an agent's click has some, otherwise with wry's Finder panel, as
    /// for any click of the person's.
    unsafe fn intercept_open_panel(wk: *mut AnyObject) -> Result<(), String> {
        let mut result = Ok(());
        INTERCEPT.call_once(|| {
            let delegate: *mut AnyObject = msg_send![wk, UIDelegate];
            if delegate.is_null() {
                result = Err("the web view has no UI delegate".into());
                return;
            }
            let cls = objc2::ffi::object_getClass(delegate as *const AnyObject) as *mut AnyClass;
            let sel = sel!(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:);
            let method = objc2::ffi::class_getInstanceMethod(cls, sel);
            if method.is_null() {
                result = Err("the web view's delegate has no open panel".into());
                return;
            }
            let types = objc2::ffi::method_getTypeEncoding(method);
            let ours: Imp = std::mem::transmute::<OpenPanelFn, Imp>(open_panel);
            let original = objc2::ffi::class_replaceMethod(cls, sel, ours, types);
            let _ = ORIGINAL_OPEN_PANEL
                .set(original.map(|imp| std::mem::transmute::<Imp, OpenPanelFn>(imp)));
        });
        result
    }

    unsafe extern "C-unwind" fn open_panel(
        this: *mut AnyObject,
        cmd: Sel,
        webview: *mut AnyObject,
        params: *mut AnyObject,
        frame: *mut AnyObject,
        handler: *mut block2::Block<dyn Fn(*const AnyObject)>,
    ) {
        let offered = {
            let mut offer = OFFER.lock().unwrap();
            match offer.as_mut() {
                Some(o) if !o.taken => {
                    o.taken = true;
                    Some(o.paths.clone())
                }
                _ => None,
            }
        };
        let Some(paths) = offered else {
            if let Some(original) = ORIGINAL_OPEN_PANEL.get().copied().flatten() {
                original(this, cmd, webview, params, frame, handler);
            } else if !handler.is_null() {
                (*handler).call((std::ptr::null(),));
            }
            return;
        };
        let multiple: bool = msg_send![params, allowsMultipleSelection];
        let urls: *mut AnyObject = msg_send![class!(NSMutableArray), array];
        for path in paths.iter().take(if multiple { usize::MAX } else { 1 }) {
            let Ok(path) = ns_string(path) else { continue };
            let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: path];
            if !url.is_null() {
                let _: () = msg_send![urls, addObject: url];
            }
        }
        if !handler.is_null() {
            (*handler).call((urls as *const AnyObject,));
        }
    }

    // ---------- strings ----------

    unsafe fn ns_string(s: &str) -> Result<*mut AnyObject, String> {
        let c = CString::new(s).map_err(|_| "text contains a NUL byte".to_string())?;
        let ns: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
        if ns.is_null() {
            return Err("couldn't make a string".into());
        }
        Ok(ns)
    }

    unsafe fn rust_string(obj: *mut AnyObject) -> Option<String> {
        if obj.is_null() {
            return None;
        }
        let utf8: *const c_char = msg_send![obj, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }

    unsafe fn data_bytes(data: *mut AnyObject) -> Option<Vec<u8>> {
        if data.is_null() {
            return None;
        }
        let len: usize = msg_send![data, length];
        let bytes: *const u8 = msg_send![data, bytes];
        if bytes.is_null() {
            return Some(Vec::new());
        }
        Some(std::slice::from_raw_parts(bytes, len).to_vec())
    }
}
