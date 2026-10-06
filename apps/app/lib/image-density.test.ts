import { describe, expect, it } from "vitest"
import { fileNameDensity, imageDensity, pngDensity } from "@/lib/image-density"

/** A PNG head: the signature, IHDR, an optional pHYs, then IDAT. */
function png(phys?: { perMetre: number; unit: number }): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const length = data.length
    return [
      (length >>> 24) & 255,
      (length >>> 16) & 255,
      (length >>> 8) & 255,
      length & 255,
      ...[...type].map((c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0,
    ]
  }
  const u32 = (n: number) => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ]
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(2880), ...u32(1800), 8, 6, 0, 0, 0]),
    ...(phys
      ? chunk("pHYs", [...u32(phys.perMetre), ...u32(phys.perMetre), phys.unit])
      : []),
    ...chunk("IDAT", [1, 2, 3]),
  ])
}

describe("pngDensity", () => {
  it("reads a macOS screenshot's 144dpi as 2x", () => {
    expect(pngDensity(png({ perMetre: 5669, unit: 1 }))).toBe(2)
  })

  it("reads 216dpi as 3x", () => {
    expect(pngDensity(png({ perMetre: 8504, unit: 1 }))).toBe(3)
  })

  it("takes 72 and 96dpi as no hint", () => {
    expect(pngDensity(png({ perMetre: 2835, unit: 1 }))).toBeNull()
    expect(pngDensity(png({ perMetre: 3779, unit: 1 }))).toBeNull()
  })

  it("ignores an aspect-ratio-only pHYs", () => {
    expect(pngDensity(png({ perMetre: 5669, unit: 0 }))).toBeNull()
  })

  it("returns null without pHYs, or for a file that isn't a PNG", () => {
    expect(pngDensity(png())).toBeNull()
    expect(pngDensity(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
    expect(
      pngDensity(png({ perMetre: 5669, unit: 1 }).subarray(0, 40))
    ).toBeNull()
  })
})

describe("fileNameDensity", () => {
  it("reads @2x and @3x before the extension", () => {
    expect(fileNameDensity("uploads/hero@2x.png")).toBe(2)
    expect(fileNameDensity("https://x.dev/a@3x.jpg?v=1")).toBe(3)
  })

  it("ignores names without one", () => {
    expect(fileNameDensity("uploads/hero.png")).toBeNull()
    expect(fileNameDensity("uploads/me@home.png")).toBeNull()
    expect(fileNameDensity("uploads/icon@1x.png")).toBeNull()
  })
})

describe("imageDensity", () => {
  it("prefers the PNG's hint, then the name, then width", () => {
    expect(imageDensity({ src: "a@3x.png", naturalWidth: 400, png: 2 })).toBe(2)
    expect(
      imageDensity({ src: "a@3x.png", naturalWidth: 400, png: null })
    ).toBe(3)
    expect(imageDensity({ src: "a.png", naturalWidth: 2880, png: null })).toBe(
      2
    )
    expect(imageDensity({ src: "a.png", naturalWidth: 1000, png: null })).toBe(
      1
    )
  })
})
