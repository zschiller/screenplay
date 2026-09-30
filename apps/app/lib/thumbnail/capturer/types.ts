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
/**
 * The shape to render the preview at — the frame's own world-space size. The
 * iframe on the canvas renders its page at exactly these dimensions, so the
 * capturer screenshots at the same viewport: the screenshot then shares the
 * frame's aspect ratio and the downstream resize is a pure downscale, never a
 * crop. Without this every frame was screenshot at one fixed viewport and then
 * cropped to fit, so wide or tall frames lost most of the page.
 */
export type CaptureViewport = {
  width: number
  height: number
}

export interface ThumbnailCapturer {
  /**
   * Render the page at `previewUrl`, sized to `viewport` (the frame's shape),
   * and return a raw PNG screenshot buffer.
   */
  capture(previewUrl: string, viewport: CaptureViewport): Promise<Buffer>
}

/**
 * The same render, read instead of screenshot: `read_frame_html` (#1268) loads
 * a frame's preview in the capturer's browser and asks the Sandbox Bridge on
 * the page for its markup and styles. Each capturer backend implements both
 * seams, so a build that can screenshot a frame can also read it.
 */
export interface FramePageReader {
  /**
   * Render the page at `previewUrl`, sized to `viewport`, let it settle, then
   * run `script` (the body of an async function) in it and return the string
   * it resolves to.
   */
  evaluate(
    previewUrl: string,
    viewport: CaptureViewport,
    script: string
  ): Promise<string>
}
