import "server-only"

import type { ThumbnailCapturer } from "./types"

/**
 * The base URL of the Tauri shell's localhost control server, handed to the
 * Node sidecar at spawn time. The shell binds it on its own ephemeral port (so
 * it never collides with the app's port) and passes the resolved value through
 * here — the sidecar never guesses the port.
 */
export const TAURI_CONTROL_URL_ENV_VAR = "TAURI_CONTROL_URL"

/** The control-server route that renders a URL in a webview and screenshots it. */
const THUMBNAIL_CONTROL_PATH = "/thumbnail"

/**
 * Capturing in the desktop build can't spin up a headless Chromium — the whole
 * point of packaging is to ship without one. The render still has to happen in
 * a real webview, and the app already runs inside one: the Tauri shell. So the
 * `capture` timeout matches the puppeteer path's nav + ready budget with headroom.
 */
const CAPTURE_TIMEOUT_MS = 20_000

/**
 * The desktop Thumbnail Capturer: instead of driving its own browser, it asks
 * the **Tauri shell** to render the page in a background webview and screenshot
 * it. The shell exposes a tiny localhost control server (its URL arrives via
 * `TAURI_CONTROL_URL`); this capturer POSTs the render URL there and gets raw
 * PNG bytes back. Everything downstream — the `sharp` resize, `BlobStore.put`,
 * and Thumbnail Manifest write in `captureRoomThumbnail` — is unchanged, so this
 * is a drop-in sibling of the puppeteer capturer behind the same seam.
 */
class TauriWebviewCapturer implements ThumbnailCapturer {
  async capture(previewUrl: string): Promise<Buffer> {
    const controlUrl = process.env[TAURI_CONTROL_URL_ENV_VAR]
    if (!controlUrl) {
      throw new Error(
        `${TAURI_CONTROL_URL_ENV_VAR} is not set — the Tauri-webview capturer ` +
          `can only run inside the desktop shell, which injects the control ` +
          `server's URL at sidecar spawn time.`
      )
    }

    const endpoint = new URL(THUMBNAIL_CONTROL_PATH, controlUrl)
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The shell's control server keys this `renderUrl` (serde rename in
      // `thumbnail.rs`); keep the wire field name even though it's now a frame's
      // preview URL.
      body: JSON.stringify({ renderUrl: previewUrl }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(
        `Tauri control server returned ${response.status} ${response.statusText} ` +
          `capturing ${previewUrl}`
      )
    }

    return Buffer.from(await response.arrayBuffer())
  }
}

export function getTauriWebviewCapturer(): ThumbnailCapturer {
  return new TauriWebviewCapturer()
}
