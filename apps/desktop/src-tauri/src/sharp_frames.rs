//! Frames stay sharp when the canvas zooms in.
//!
//! A frame or Mockup is a page in an iframe inside the canvas's zoomed content.
//! WebKit paints most of the canvas again at each zoom, so it stays sharp, but
//! it gives a page its own compositing layer when the page or something in it
//! scrolls (async frame and overflow scrolling), and draws that layer at the
//! screen's 2x before the zoom stretches it: at 800% a scrolling page is a
//! blurry 2x bitmap. Tested on macOS 26 in a bare WKWebView (screencapture of
//! the real window; Playwright's WebKit snapshots repaint and hide it): with
//! these two WebKit features off, a scrolling page or an inner scroller under
//! scale(8) is as sharp as plain text.
//!
//! The cost: scrolling in the app and in its frames runs on the web process's
//! main thread instead of the scrolling thread. A page that composites
//! something itself (a fixed header, `will-change`, a running transform
//! animation) still gets a 2x layer and still blurs when zoomed in; no WebKit
//! setting or CSS we found changes that.
//!
//! `_features` and `_setEnabled:forFeature:` are WebKit SPI (MiniBrowser's
//! feature toggles). Both are checked before use, so a WebKit without them
//! just keeps async scrolling.

/// Turn off async frame and overflow scrolling in the main window's webview.
/// Call before it navigates to the app, so the app's page loads with them off.
pub fn apply(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let dispatched = window.with_webview(move |webview| unsafe {
            macos::disable_async_scrolling(webview.inner() as *mut objc2::runtime::AnyObject);
            let _ = tx.send(());
        });
        // `with_webview` runs on the main thread; wait so the navigation that
        // follows loads with the features already off.
        if dispatched.is_ok() {
            let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, CStr};

    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{class, msg_send, sel};

    const FEATURES_OFF: [&str; 2] = [
        "AsyncFrameScrollingEnabled",
        "AsyncOverflowScrollingEnabled",
    ];

    pub unsafe fn disable_async_scrolling(wk: *mut AnyObject) {
        if wk.is_null() {
            return;
        }
        // The live preferences: `configuration` is a copy, but it shares the
        // web view's WKPreferences object.
        let config: *mut AnyObject = msg_send![wk, configuration];
        if config.is_null() {
            return;
        }
        let prefs: *mut AnyObject = msg_send![config, preferences];
        if prefs.is_null() {
            return;
        }
        let class: &AnyClass = class!(WKPreferences);
        let has_features: bool = msg_send![class, respondsToSelector: sel!(_features)];
        let can_set: bool = msg_send![prefs, respondsToSelector: sel!(_setEnabled:forFeature:)];
        if !has_features || !can_set {
            eprintln!("[shell] WebKit feature SPI missing; frames keep async scrolling");
            return;
        }
        let features: *mut AnyObject = msg_send![class, _features];
        if features.is_null() {
            return;
        }
        let count: usize = msg_send![features, count];
        for i in 0..count {
            let feature: *mut AnyObject = msg_send![features, objectAtIndex: i];
            if feature.is_null() {
                continue;
            }
            let key: *mut AnyObject = msg_send![feature, key];
            if key.is_null() {
                continue;
            }
            let utf8: *const c_char = msg_send![key, UTF8String];
            if utf8.is_null() {
                continue;
            }
            let Ok(name) = CStr::from_ptr(utf8).to_str() else {
                continue;
            };
            if FEATURES_OFF.contains(&name) {
                let _: () = msg_send![prefs, _setEnabled: false, forFeature: feature];
            }
        }
    }
}
