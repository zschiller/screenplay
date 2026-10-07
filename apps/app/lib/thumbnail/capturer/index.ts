import "server-only"

import { toInternalPreviewUrl } from "@/lib/sandbox"

import { selectThumbnailCapturer } from "./select"
import type { FramePageReader, ThumbnailCapturer } from "./types"

export type { FramePageReader, ThumbnailCapturer } from "./types"
export {
  THUMBNAIL_CAPTURER_ENV_VAR,
  capturerChoiceFromEnv,
  selectThumbnailCapturer,
} from "./select"
export type { ThumbnailCapturerChoice } from "./select"

/**
 * The configured Thumbnail Capturer singleton, selected at build time by the
 * `THUMBNAIL_CAPTURER` env var — headless Chromium by default (hosted,
 * unchanged), the Tauri-webview capturer for the desktop build. See `./select`.
 */
const selected = selectThumbnailCapturer()

/**
 * Every page it loads goes to the preview's own address, never the URL a
 * browser loads (`toInternalPreviewUrl`): thumbnails, `view_frame`,
 * `read_frame_html` and `screenshot_page` all come through here.
 */
export const thumbnailCapturer: ThumbnailCapturer = {
  capture: async (url, viewport) =>
    selected.capture(await toInternalPreviewUrl(url), viewport),
}

/** The same backend, reading a frame's page instead of screenshotting it. */
export const framePageReader: FramePageReader = {
  evaluate: async (url, viewport, script) =>
    selected.evaluate(await toInternalPreviewUrl(url), viewport, script),
}
