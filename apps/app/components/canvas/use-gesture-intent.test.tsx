// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ResizeEdge } from "@/lib/canvas/snap"
import { baseLayer, makeHarness, seedGroup } from "@/test/canvas/harness"
import type { CanvasSelection } from "./use-canvas-selection"
import { useGestureIntent } from "./use-gesture-intent"

/** A frame with Fit to content on, and the gesture's apply side. */
function fittingFrame() {
  const h = makeHarness()
  h.collections.iframeLayers.set(
    "frame-1",
    baseLayer("frame-1", { width: 400, height: 900, fitHeight: true })
  )
  seedGroup(h.collections, "group-1", [{ kind: "iframe-layer", id: "frame-1" }])
  const { result } = renderHook(() =>
    useGestureIntent({
      collections: h.collections,
      ops: h.ops,
      selection: {} as CanvasSelection,
    })
  )
  const resize = (edge: ResizeEdge, width: number, height: number) =>
    result.current({
      type: "resizeLayer",
      iframeLayerId: "frame-1",
      edge,
      width,
      height,
      shiftX: 0,
      shiftY: 0,
    })
  return { ...h, resize }
}

describe("resizing a frame with Fit to content on", () => {
  it("sets the width alone from a side edge, and stays on", () => {
    const { collections, resize } = fittingFrame()
    // The gesture's height is the one it started from; the page's wins.
    collections.iframeLayers.update("frame-1", { height: 1100 })
    resize("e", 600, 900)
    expect(collections.iframeLayers.get("frame-1")).toMatchObject({
      width: 600,
      height: 1100,
      fitHeight: true,
    })
  })

  it.each<ResizeEdge>(["s", "n", "se", "nw"])(
    "turns it off when the %s edge sets the height",
    (edge) => {
      const { collections, resize } = fittingFrame()
      resize(edge, 400, 700)
      expect(collections.iframeLayers.get("frame-1")).toMatchObject({
        width: 400,
        height: 700,
        fitHeight: false,
      })
    }
  )
})
