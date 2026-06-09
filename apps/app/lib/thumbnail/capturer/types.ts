import "server-only"

/**
 * The seam that turns a Room's render URL into a raw screenshot. The default
 * implementation (`./puppeteer`) drives a headless Chromium; the desktop build
 * drops in a sibling that drives the Tauri webview instead. Everything
 * downstream — the `sharp` resize, `BlobStore.put`, and `setRoomThumbnail`
 * write — is shared orchestration in `captureRoomThumbnail`, so a new capturer
 * is a drop-in, not a fork of the capture path.
 */
export interface ThumbnailCapturer {
  /** Render the page at `renderUrl` and return a raw PNG screenshot buffer. */
  capture(renderUrl: string): Promise<Buffer>
}
