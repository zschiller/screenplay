# 34. Zoomed frames on Mac WebKit stay blurry

Date: 2026-10-06

Status: Accepted (backfilled 2026-10-07)

## Context

Zoomed into a frame or Mockup on the Mac app, the page blurs. Measured on
Zack's Mac (macOS 26.6, a bare WKWebView panel): WebKit gives an iframe
document its own layer when it scrolls asynchronously or holds a composited
element, rasters it at 2×, and the canvas scale stretches that raster.

PR #1800 turned off the WebKit features `AsyncFrameScrollingEnabled` and
`AsyncOverflowScrollingEnabled` through private API in the desktop shell. That
sharpened scrolling pages in the bare test window, but every page and Mockup in
the real app still blurred (real pages composite something else), so it was
reverted in PR #1802.

## Decision

- **Leave the blur.** No feature flags, no CSS workaround.

## Consequences

- Zoomed frames on the Mac stay soft; Chromium hosted is unaffected. The pixel
  grid past 400% (PR #1798) is drawn in screen space and stays sharp.
- A fix would start from the real app's layer tree on a Mac, not a cloud
  browser: WebKitGTK in the cloud doesn't reproduce Mac compositing.

Rejected and not worth retrying: turning off async scrolling (PR #1800); CSS
`zoom` on the iframe; `zoom` with a `scale(1/z)` counter-scale; re-inserting
the iframe; `will-change`; `ThreadedScrollingEnabled` off; `scrolling="no"` set
after load.
