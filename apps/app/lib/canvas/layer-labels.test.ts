import { describe, expect, it } from "vitest"

import { hiddenGroupLabels, hiddenLayerLabels } from "./layer-labels"

const frame = (
  id: string,
  x: number,
  y: number,
  width = 1280,
  height = 800
) => ({
  id,
  x,
  y,
  width,
  height,
})

describe("hiddenLayerLabels", () => {
  it("keeps names at the minimum zoom while frames are wide enough", () => {
    // A 1280px frame at 10% is 128px wide on screen.
    expect(hiddenLayerLabels([frame("a", 0, 0)], 0.1).size).toBe(0)
  })

  it("hides a name once its frame is too narrow on screen", () => {
    const phone = frame("phone", 0, 0, 390, 844)
    expect(hiddenLayerLabels([phone], 0.1)).toEqual(new Set(["phone"]))
    expect(hiddenLayerLabels([phone], 0.2).size).toBe(0)
  })

  it("hides a far-out name that would sit on the frame above it", () => {
    // 20px at 10% is 200 world units; the row below starts 100 under "top".
    const layouts = [frame("top", 0, 0), frame("below", 0, 900)]
    expect(hiddenLayerLabels(layouts, 0.1)).toEqual(new Set(["below"]))
    // At detail zoom labels keep their place.
    expect(hiddenLayerLabels(layouts, 0.5).size).toBe(0)
  })

  it("keeps names beside each other in a row", () => {
    const layouts = [frame("a", 0, 0), frame("b", 1340, 0, 390, 844)]
    expect(hiddenLayerLabels(layouts, 0.2).size).toBe(0)
  })
})

describe("hiddenGroupLabels", () => {
  const leaders = new Map([["g", "a"]])

  it("keeps a group label far out while its frame has room", () => {
    expect(hiddenGroupLabels([frame("a", 0, 0)], leaders, 0.1).size).toBe(0)
  })

  it("hides it with its frame's name when the frame is too narrow", () => {
    const phone = frame("a", 0, 0, 390, 844)
    expect(hiddenGroupLabels([phone], leaders, 0.1)).toEqual(new Set(["g"]))
  })

  it("hides it far out where it would sit on the frame above", () => {
    // Name and group label take 42px: 420 world units at 10%. The name alone
    // (200) clears the 300 gap; with the group label it doesn't.
    const layouts = [frame("top", 0, 0), frame("a", 0, 1100)]
    expect(hiddenGroupLabels(layouts, leaders, 0.1)).toEqual(new Set(["g"]))
    expect(hiddenLayerLabels(layouts, 0.1).size).toBe(0)
    expect(hiddenGroupLabels(layouts, leaders, 0.5).size).toBe(0)
  })
})
