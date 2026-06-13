import "server-only"

/**
 * The seam that turns a single Iframe Layer's live preview URL into a raw
 * screenshot — called once per frame by `captureRoomThumbnail`. The default
 * implementation (`./puppeteer`) drives a headless Chromium; the desktop build
 * drops in a sibling that drives the Tauri webview instead. Everything
 * downstream — the `sharp` resize, `BlobStore.put`, and Thumbnail Manifest
 * write — is shared orchestration in `captureRoomThumbnail`, so a new capturer
 * is a drop-in, not a fork of the capture path.
 */
export interface ThumbnailCapturer {
  /** Render the page at `previewUrl` and return a raw PNG screenshot buffer. */
  capture(previewUrl: string): Promise<Buffer>
}
