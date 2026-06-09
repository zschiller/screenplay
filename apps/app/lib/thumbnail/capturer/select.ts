import "server-only"

import { getPuppeteerCapturer } from "./puppeteer"
import { getTauriWebviewCapturer } from "./tauri-webview"
import type { ThumbnailCapturer } from "./types"

/**
 * Which {@link ThumbnailCapturer} backend a build runs on. Mirrors the sibling
 * seams' selection style (`BLOB_STORE`, `AGENT_ENGINE`): a per-build env var,
 * not a per-Room column, so one repo produces both the hosted deployment
 * (headless Chromium) and the desktop build (the Tauri webview) without forking
 * the capture path.
 */
export type ThumbnailCapturerChoice = "puppeteer" | "tauri-webview"

/** The env var a build sets to pick the capturer backend. */
export const THUMBNAIL_CAPTURER_ENV_VAR = "THUMBNAIL_CAPTURER"

/**
 * Read the capturer choice from the environment, defaulting to `puppeteer` (the
 * hosted default). Only the explicit value `tauri-webview` opts into the desktop
 * capturer; anything else — unset, empty, or unrecognised — stays on headless
 * Chromium, so a typo never silently swaps the capturer.
 */
export function capturerChoiceFromEnv(
  env: Record<string, string | undefined> = process.env
): ThumbnailCapturerChoice {
  return env[THUMBNAIL_CAPTURER_ENV_VAR] === "tauri-webview"
    ? "tauri-webview"
    : "puppeteer"
}

/** Resolve the configured {@link ThumbnailCapturer} for the current build. */
export function selectThumbnailCapturer(
  env: Record<string, string | undefined> = process.env
): ThumbnailCapturer {
  return capturerChoiceFromEnv(env) === "tauri-webview"
    ? getTauriWebviewCapturer()
    : getPuppeteerCapturer()
}
