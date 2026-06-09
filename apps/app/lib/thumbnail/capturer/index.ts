import "server-only"

import { getPuppeteerCapturer } from "./puppeteer"
import type { ThumbnailCapturer } from "./types"

export type { ThumbnailCapturer } from "./types"

/**
 * The configured Thumbnail Capturer singleton. Today this is always the
 * headless-Chromium path; the desktop build swaps in a Tauri-webview capturer
 * behind this same re-export (the swap lands in the assembly slice).
 */
export const thumbnailCapturer: ThumbnailCapturer = getPuppeteerCapturer()
