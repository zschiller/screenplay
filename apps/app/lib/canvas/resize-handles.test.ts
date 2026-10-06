import { describe, expect, it } from "vitest"

import { resizeGrabZones, visibleResizeHandles } from "./resize-handles"

describe("visibleResizeHandles", () => {
  it("draws all eight handles on a roomy Layer", () => {
    expect(visibleResizeHandles(1280, 800)).toHaveLength(8)
  })

  it("keeps every handle while none overlap", () => {
    expect(visibleResizeHandles(16, 16)).toHaveLength(8)
  })

  it("drops a side's middle handle once it would overlap the corners", () => {
    expect(visibleResizeHandles(15, 400).sort()).toEqual(
      ["e", "ne", "nw", "se", "sw", "w"].sort()
    )
    expect(visibleResizeHandles(400, 15).sort()).toEqual(
      ["n", "ne", "nw", "s", "se", "sw"].sort()
    )
  })

  it("keeps the corners until they would overlap each other", () => {
    expect(visibleResizeHandles(8, 8).sort()).toEqual(
      ["ne", "nw", "se", "sw"].sort()
    )
    expect(visibleResizeHandles(7, 400)).toEqual([])
  })
})

describe("resizeGrabZones", () => {
  it("centres full-size zones on a roomy Layer's bounds", () => {
    const { corner, edge } = resizeGrabZones(1280, 800)
    expect(corner.x).toEqual({ inside: 6, outside: 6 })
    expect(edge.y).toEqual({ inside: 3, outside: 3 })
  })

  it("keeps a grab zone at every size, however small", () => {
    for (const side of [0, 1, 4, 10, 47]) {
      const { corner, edge } = resizeGrabZones(side, side)
      expect(corner.x.inside + corner.x.outside).toBe(12)
      expect(edge.y.inside + edge.y.outside).toBe(6)
    }
  })

  it("leaves the middle half of a small Layer free to move it", () => {
    const { corner, edge } = resizeGrabZones(8, 20)
    expect(corner.x.inside).toBe(2)
    expect(corner.y.inside).toBe(5)
    expect(edge.x.inside).toBe(2)
    expect(edge.y.inside).toBe(3)
  })
})
