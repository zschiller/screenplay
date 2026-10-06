import { describe, expect, it } from "vitest"

import { layerOffCanvas } from "./use-layer-toolbar"

const canvas = { left: 200, top: 50, right: 1000, bottom: 750 }
const rect = (left: number, top: number, width = 300, height = 200) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

describe("layerOffCanvas", () => {
  it("keeps the toolbar while any part of the layer is on screen", () => {
    expect(layerOffCanvas(rect(400, 200), canvas)).toBe(false)
    // Mostly off the left edge, a sliver still showing.
    expect(layerOffCanvas(rect(-90, 200), canvas)).toBe(false)
    // Only the top strip showing at the bottom edge.
    expect(layerOffCanvas(rect(400, 740), canvas)).toBe(false)
    // Exactly touching an edge.
    expect(layerOffCanvas(rect(-100, 200), canvas)).toBe(false)
  })

  it("hides once the layer is wholly past any edge", () => {
    expect(layerOffCanvas(rect(-101, 200), canvas)).toBe(true)
    expect(layerOffCanvas(rect(1001, 200), canvas)).toBe(true)
    expect(layerOffCanvas(rect(400, -151), canvas)).toBe(true)
    expect(layerOffCanvas(rect(400, 751), canvas)).toBe(true)
  })
})
