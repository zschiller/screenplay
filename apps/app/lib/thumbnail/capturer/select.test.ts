import { describe, expect, it } from "vitest"

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
