import { describe, expect, it } from "vitest"

import {
  ANSI_COLOR_KEYS,
  ANSI_PALETTE,
  ANSI_PALETTE_CSS,
  ansiClassIndex,
  xterm256Rgb,
  xtermAnsiTheme,
  type AnsiMode,
} from "./ansi-palette"

/**
 * The theme backgrounds the palette is painted on: `--background` in
 * `packages/ui/src/styles/globals.css` — `oklch(1 0 0)` and `oklch(0.145 0 0)`,
 * resolved to sRGB.
 */
const BACKGROUND: Record<AnsiMode, string> = {
  light: "#ffffff",
  dark: "#0a0a0a",
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe("ANSI_PALETTE", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`gives all 16 colours AA contrast on the ${mode} background`, () => {
      expect(ANSI_PALETTE[mode]).toHaveLength(16)
      const failing = ANSI_PALETTE[mode]
        .map((hex, i) => ({
          color: ANSI_COLOR_KEYS[i],
          hex,
          ratio: Number(contrast(hex, BACKGROUND[mode]).toFixed(2)),
        }))
        .filter((c) => c.ratio < 4.5)
      expect(failing).toEqual([])
    })
  }

  it("builds an xterm theme with every ANSI key", () => {
    const theme = xtermAnsiTheme("light")
    expect(Object.keys(theme)).toEqual([...ANSI_COLOR_KEYS])
    expect(theme.brightWhite).toBe(ANSI_PALETTE.light[15])
  })

  it("publishes a CSS variable per colour, per theme", () => {
    expect(ANSI_PALETTE_CSS).toContain(
      `:root{--ansi-0:${ANSI_PALETTE.light[0]};`
    )
    expect(ANSI_PALETTE_CSS).toContain(
      `.dark{--ansi-0:${ANSI_PALETTE.dark[0]};`
    )
    expect(ANSI_PALETTE_CSS).toContain(`--ansi-15:${ANSI_PALETTE.dark[15]};`)
  })
})

describe("ansiClassIndex", () => {
  it("maps anser's named classes onto the 16", () => {
    expect(ansiClassIndex("ansi-black")).toBe(0)
    expect(ansiClassIndex("ansi-white")).toBe(7)
    expect(ansiClassIndex("ansi-bright-black")).toBe(8)
    expect(ansiClassIndex("ansi-bright-cyan")).toBe(14)
  })

  it("keeps 256-colour indices inside the base 16 on the palette", () => {
    expect(ansiClassIndex("ansi-palette-3")).toBe(3)
    expect(ansiClassIndex("ansi-palette-15")).toBe(15)
    expect(ansiClassIndex("ansi-palette-16")).toBeNull()
  })

  it("leaves truecolour and unknown classes alone", () => {
    expect(ansiClassIndex("ansi-truecolor")).toBeNull()
    expect(ansiClassIndex("ansi-bright-purple")).toBeNull()
  })
})

describe("xterm256Rgb", () => {
  it("resolves the colour cube and the grey ramp", () => {
    expect(xterm256Rgb(16)).toEqual([0, 0, 0])
    expect(xterm256Rgb(196)).toEqual([255, 0, 0])
    expect(xterm256Rgb(231)).toEqual([255, 255, 255])
    expect(xterm256Rgb(232)).toEqual([8, 8, 8])
    expect(xterm256Rgb(255)).toEqual([238, 238, 238])
  })
})
