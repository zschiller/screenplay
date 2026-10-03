import { describe, expect, it } from "vitest"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import {
  cleanRunSettings,
  DEFAULT_DEV_SERVER_PORT,
  parseDevServerPort,
  parseRunSettings,
  pickRunSettings,
  runSettingsFields,
  sameRunSettings,
  validateRunSettings,
  type RunSettings,
} from "@/lib/run-settings"

const settings: RunSettings = {
  setupScript: "pnpm install",
  devScript: "pnpm dev",
  devServerPort: 5173,
  copyPatterns: ".env*",
  defaultIframeLayerSizeId: "iphone-16",
  systemPrompt: "Use pnpm.",
}

describe("runSettingsFields", () => {
  it("starts a new Repository at the plain defaults", () => {
    expect(runSettingsFields()).toEqual({
      setupScript: "",
      devScript: "",
      devServerPort: String(DEFAULT_DEV_SERVER_PORT),
      copyPatterns: "",
      defaultIframeLayerSizeId: DEFAULT_IFRAME_LAYER_SIZE_ID,
      systemPrompt: "",
    })
  })

  it("seeds a form from saved settings, with the port as text", () => {
    expect(runSettingsFields(settings)).toEqual({
      ...settings,
      devServerPort: "5173",
    })
  })
})

describe("port validation", () => {
  it.each([
    ["3000", 3000],
    ["1", 1],
    ["65535", 65535],
  ])("takes %s", (text, port) => {
    expect(parseDevServerPort(text)).toBe(port)
  })

  it.each(["", "0", "-1", "65536", "abc"])("refuses %j", (text) => {
    expect(parseDevServerPort(text)).toBeUndefined()
    expect(
      validateRunSettings({ ...runSettingsFields(), devServerPort: text })
    ).toBe(false)
    expect(
      parseRunSettings({ ...runSettingsFields(), devServerPort: text })
    ).toBeUndefined()
  })
})

describe("cleanRunSettings", () => {
  it("trims text and leaves blank optional fields unset", () => {
    expect(
      cleanRunSettings({
        setupScript: "  pnpm install\n",
        devScript: "pnpm dev ",
        devServerPort: 3000,
        copyPatterns: "  \n",
        systemPrompt: " Use pnpm. \n",
      })
    ).toEqual({
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 3000,
      copyPatterns: undefined,
      defaultIframeLayerSizeId: undefined,
      systemPrompt: "Use pnpm.",
    })
  })

  it("is what a form saves", () => {
    expect(
      parseRunSettings({
        ...runSettingsFields(settings),
        systemPrompt: "Use pnpm.\n\n",
      })
    ).toEqual(settings)
  })
})

describe("sameRunSettings", () => {
  it("ignores whitespace around text", () => {
    expect(
      sameRunSettings(settings, {
        ...settings,
        setupScript: "pnpm install\n",
        systemPrompt: "  Use pnpm.\n",
        copyPatterns: ".env* ",
      })
    ).toBe(true)
  })

  it("reads unset fields at their defaults", () => {
    expect(
      sameRunSettings(
        { setupScript: "", devScript: "", devServerPort: 3000 },
        {
          setupScript: "",
          devScript: "",
          devServerPort: DEFAULT_DEV_SERVER_PORT,
          copyPatterns: "",
          defaultIframeLayerSizeId: DEFAULT_IFRAME_LAYER_SIZE_ID,
          systemPrompt: " ",
        }
      )
    ).toBe(true)
  })

  it.each<keyof RunSettings>([
    "setupScript",
    "devScript",
    "copyPatterns",
    "defaultIframeLayerSizeId",
    "systemPrompt",
  ])("tells a changed %s apart", (field) => {
    expect(sameRunSettings(settings, { ...settings, [field]: "other" })).toBe(
      false
    )
  })

  it("tells a changed port apart", () => {
    expect(
      sameRunSettings(settings, { ...settings, devServerPort: 8080 })
    ).toBe(false)
  })
})

describe("pickRunSettings", () => {
  it("copies only the run settings", () => {
    const repository = { ...settings, name: "web", envVars: "A=1" }
    expect(pickRunSettings(repository)).toEqual(settings)
  })
})
