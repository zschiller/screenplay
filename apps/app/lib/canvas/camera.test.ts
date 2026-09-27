import { describe, expect, it } from "vitest"

import {
  fitRectToViewport,
  fitScale,
  showsLayerDetail,
  stepZoom,
  unionRect,
  zoomAtPoint,
  type Rect,
  type ViewportSize,
} from "@/lib/canvas/camera"

// Plain fixtures — no live transform, no DOM. The zoom-to-fit math is pure
// geometry: a rect + a viewport size + padding/clamps in, a transform out. These
// pin the fit scale (width- vs height-constrained), the min/max clamps, the
// padding, and the centering offset.

const viewport: ViewportSize = { width: 1000, height: 800 }

describe("fitScale", () => {
  it("is width-constrained for a wide target", () => {
    // (1000 - 40) / 1920 ≈ 0.5 is smaller than the height-constrained scale.
    expect(fitScale(1920, 200, viewport, { padding: 20, maxZoom: 5 })).toBeCloseTo(
      (1000 - 40) / 1920
    )
  })

  it("is height-constrained for a tall target", () => {
    expect(fitScale(200, 2000, viewport, { padding: 20, maxZoom: 5 })).toBeCloseTo(
      (800 - 40) / 2000
    )
  })

  it("clamps to maxZoom for a tiny target", () => {
    expect(fitScale(10, 10, viewport, { padding: 20, maxZoom: 5 })).toBe(5)
  })

  it("clamps to minZoom for a huge target when one is given", () => {
    expect(
      fitScale(100000, 100000, viewport, { padding: 20, maxZoom: 5, minZoom: 0.1 })
    ).toBe(0.1)
  })

  it("does not clamp below the fit scale without a minZoom", () => {
    const scale = fitScale(100000, 100000, viewport, { padding: 20, maxZoom: 5 })
    expect(scale).toBeLessThan(0.1)
  })
})

describe("fitRectToViewport", () => {
  it("centers the rect at the viewport center for the fit zoom", () => {
    const rect: Rect = { x: 100, y: 100, width: 1920, height: 200 }
    const t = fitRectToViewport(rect, viewport, { padding: 20, maxZoom: 5 })

    const expectedScale = (1000 - 40) / 1920
    expect(t.zoom).toBeCloseTo(expectedScale)

    // The rect center, projected through the transform, lands at the viewport
    // center.
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    expect(t.x + centerX * t.zoom).toBeCloseTo(viewport.width / 2)
    expect(t.y + centerY * t.zoom).toBeCloseTo(viewport.height / 2)
  })

  it("respects the maxZoom clamp while still centering", () => {
    const rect: Rect = { x: 0, y: 0, width: 10, height: 10 }
    const t = fitRectToViewport(rect, viewport, { padding: 20, maxZoom: 5 })
    expect(t.zoom).toBe(5)
    expect(t.x + 5 * t.zoom).toBeCloseTo(viewport.width / 2)
    expect(t.y + 5 * t.zoom).toBeCloseTo(viewport.height / 2)
  })
})

describe("stepZoom", () => {
  it("steps to the neighbouring stop in either direction", () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
  })

  it("goes to the nearest stop from an in-between zoom", () => {
    expect(stepZoom(0.6, 1)).toBe(0.75)
    expect(stepZoom(0.6, -1)).toBe(0.5)
  })

  it("stays at the ends", () => {
    expect(stepZoom(5, 1)).toBe(5)
    expect(stepZoom(0.1, -1)).toBe(0.1)
  })
})

describe("zoomAtPoint", () => {
  it("keeps the world point under the anchor fixed", () => {
    const before = { x: 100, y: 50, zoom: 1 }
    const anchor = { x: 500, y: 400 }
    const after = zoomAtPoint(before, 2, anchor)
    const worldBefore = (anchor.x - before.x) / before.zoom
    const worldAfter = (anchor.x - after.x) / after.zoom
    expect(worldAfter).toBeCloseTo(worldBefore)
    expect(after.zoom).toBe(2)
  })
})

describe("unionRect", () => {
  it("encloses every rect", () => {
    expect(
      unionRect([
        { x: 0, y: 10, width: 100, height: 50 },
        { x: 200, y: -20, width: 50, height: 50 },
      ])
    ).toEqual({ x: 0, y: -20, width: 250, height: 80 })
  })

  it("is null for nothing", () => {
    expect(unionRect([])).toBeNull()
  })
})

describe("showsLayerDetail", () => {
  it("hides layer detail below a quarter zoom", () => {
    expect(showsLayerDetail(0.25)).toBe(true)
    expect(showsLayerDetail(0.1)).toBe(false)
  })
})
