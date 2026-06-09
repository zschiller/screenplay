import "server-only"

import { selectThumbnailCapturer } from "./select"
import type { ThumbnailCapturer } from "./types"

export type { ThumbnailCapturer } from "./types"
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
export const thumbnailCapturer: ThumbnailCapturer = selectThumbnailCapturer()
