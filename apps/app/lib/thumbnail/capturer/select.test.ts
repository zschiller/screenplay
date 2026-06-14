import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  capturerChoiceFromEnv,
  THUMBNAIL_CAPTURER_ENV_VAR,
} from "./select"

describe("capturerChoiceFromEnv", () => {
  it("defaults to puppeteer when the var is unset", () => {
    expect(capturerChoiceFromEnv({})).toBe("puppeteer")
  })

  it("selects tauri-webview only on the explicit value", () => {
    expect(
      capturerChoiceFromEnv({ [THUMBNAIL_CAPTURER_ENV_VAR]: "tauri-webview" })
    ).toBe("tauri-webview")
  })

  it("stays on puppeteer for an empty or unrecognised value (no silent swap)", () => {
    expect(capturerChoiceFromEnv({ [THUMBNAIL_CAPTURER_ENV_VAR]: "" })).toBe(
      "puppeteer"
    )
    expect(
      capturerChoiceFromEnv({ [THUMBNAIL_CAPTURER_ENV_VAR]: "webview" })
    ).toBe("puppeteer")
    expect(
      capturerChoiceFromEnv({ [THUMBNAIL_CAPTURER_ENV_VAR]: "Tauri-Webview" })
    ).toBe("puppeteer")
  })
})

// Resolve the real factories to spy capturers so selection can be exercised for
// per-frame URL input without launching Chromium or a Tauri shell: each build's
// `selectThumbnailCapturer` must hand a single localhost frame preview URL to
// the matching backend, one `capture(url)` call per frame.
const { puppeteerCapture, tauriCapture } = vi.hoisted(() => ({
  puppeteerCapture: vi.fn(async () => Buffer.from("puppeteer-png")),
  tauriCapture: vi.fn(async () => Buffer.from("tauri-png")),
}))

vi.mock("./puppeteer", () => ({
  getPuppeteerCapturer: () => ({ capture: puppeteerCapture }),
}))
vi.mock("./tauri-webview", () => ({
  getTauriWebviewCapturer: () => ({ capture: tauriCapture }),
}))

describe("selectThumbnailCapturer (per-frame URL input)", () => {
  // A desktop per-frame preview URL: the local backend's named `.localhost`
  // route for one frame's dev server (lib/sandbox/lifecycle.ts), not a
  // whole-canvas render page.
  const FRAME_URL = "http://feat-x.myapp.localhost:1355/settings"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("routes a per-frame URL to the Tauri-webview capturer for the desktop build", async () => {
    const { selectThumbnailCapturer } = await import("./select")
    const capturer = selectThumbnailCapturer({
      [THUMBNAIL_CAPTURER_ENV_VAR]: "tauri-webview",
    })

    const buf = await capturer.capture(FRAME_URL, { width: 400, height: 300 })

    expect(tauriCapture).toHaveBeenCalledTimes(1)
    expect(tauriCapture).toHaveBeenCalledWith(FRAME_URL, {
      width: 400,
      height: 300,
    })
    expect(puppeteerCapture).not.toHaveBeenCalled()
    expect(buf.toString()).toBe("tauri-png")
  })

  it("routes a per-frame URL to the puppeteer capturer for the hosted default", async () => {
    const { selectThumbnailCapturer } = await import("./select")
    const capturer = selectThumbnailCapturer({})

    const buf = await capturer.capture(FRAME_URL, { width: 400, height: 300 })

    expect(puppeteerCapture).toHaveBeenCalledTimes(1)
    expect(puppeteerCapture).toHaveBeenCalledWith(FRAME_URL, {
      width: 400,
      height: 300,
    })
    expect(tauriCapture).not.toHaveBeenCalled()
    expect(buf.toString()).toBe("puppeteer-png")
  })
})
