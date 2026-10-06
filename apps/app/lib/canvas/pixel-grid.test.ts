import { describe, expect, it } from "vitest"

import { pixelGridLines, pixelGridOpacity } from "@/lib/canvas/pixel-grid"

describe("pixelGridOpacity", () => {
  it("hides the grid up to 400%", () => {
    expect(pixelGridOpacity(1)).toBe(0)
    expect(pixelGridOpacity(4)).toBe(0)
  })

  it("fades it in between 400% and 800%", () => {
    expect(pixelGridOpacity(6)).toBe(0.5)
  })

  it("draws it at full strength from 800%", () => {
    expect(pixelGridOpacity(8)).toBe(1)
    expect(pixelGridOpacity(16)).toBe(1)
  })
})

describe("pixelGridLines", () => {
  it("puts a line on every canvas pixel edge in view", () => {
    expect(pixelGridLines(0, 8, 32, 1)).toEqual([0, 8, 16, 24])
  })

  it("follows the camera's offset, including edges left of the view", () => {
    expect(pixelGridLines(-3, 8, 32, 1)).toEqual([5, 13, 21, 29])
  })

  it("lands each line on a whole device pixel", () => {
    // 2x display, 5.3x zoom: edges at 0, 10.6, 21.2, 31.8 device px.
    expect(pixelGridLines(0, 5.3, 20, 2)).toEqual([0, 11, 21, 32])
  })
})
