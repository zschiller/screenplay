import { describe, expect, it } from "vitest"

import { showsLayerLabel, widthAcross } from "./layer-labels"

describe("showsLayerLabel", () => {
  it("keeps a name while its Layer is at least 64px wide on screen", () => {
    // A 1280px frame at 5% is exactly 64px wide on screen.
    expect(showsLayerLabel(1280, 0.05)).toBe(true)
    expect(showsLayerLabel(1280, 0.04)).toBe(false)
  })

  it("hides a phone's name before a desktop's", () => {
    // 402px at 15% is 60px: too narrow, while the 1280px frame is 192px.
    expect(showsLayerLabel(402, 0.15)).toBe(false)
    expect(showsLayerLabel(1280, 0.15)).toBe(true)
  })

  it("never hides a name for lack of room, at any zoom", () => {
    // Only width decides: no zoom on its own hides a wide Layer's name.
    for (const zoom of [0.02, 0.1, 0.25, 1, 16]) {
      expect(showsLayerLabel(64 / zoom, zoom)).toBe(true)
    }
  })
})

describe("widthAcross", () => {
  it("runs from the first rect's left edge to the furthest right edge", () => {
    const a = { x: 100, y: 0, width: 390, height: 844 }
    const b = { x: 550, y: 0, width: 1280, height: 800 }
    expect(widthAcross(a, [a, b])).toBe(1730)
    expect(widthAcross(a, [a])).toBe(390)
  })
})
