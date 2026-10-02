import { describe, expect, it } from "vitest"

import {
  CANVAS_VIEW_LIMIT,
  canvasViewSource,
  describeCanvasView,
  layersOnScreen,
} from "@/lib/canvas/canvas-view"

const screen = { left: 0, top: 0, width: 1000, height: 800 }

describe("layersOnScreen", () => {
  it("lists the layers in view, the largest share of the screen first", () => {
    expect(
      layersOnScreen(
        [
          { id: "small", rect: { left: 10, top: 10, width: 100, height: 100 } },
          { id: "big", rect: { left: 200, top: 0, width: 600, height: 600 } },
          { id: "off", rect: { left: 1200, top: 0, width: 300, height: 300 } },
        ],
        screen
      )
    ).toEqual(["big", "small"])
  })

  it("skips a sliver at the edge", () => {
    expect(
      layersOnScreen(
        [{ id: "edge", rect: { left: 950, top: 0, width: 400, height: 400 } }],
        screen
      )
    ).toEqual([])
  })

  it("counts a layer zoomed in past every edge", () => {
    expect(
      layersOnScreen(
        [
          {
            id: "zoomed",
            rect: { left: -2000, top: -2000, width: 6000, height: 6000 },
          },
        ],
        screen
      )
    ).toEqual(["zoomed"])
  })
})

describe("describeCanvasView", () => {
  const records = {
    frames: [{ id: "f1", label: "Checkout", branchId: "b1" }],
    documents: [{ id: "d1", title: "" }],
    mockups: [{ id: "m1", title: "Hero take" }],
    groups: [{ id: "g1", name: "Payments" }],
    workspaceTitles: new Map([["b1", "Pay with Apple"]]),
  }

  it("names each id by kind, Groups first in the selection", () => {
    expect(
      describeCanvasView({
        sender: "Maya",
        selectedGroupIds: ["g1"],
        selectedLayerIds: ["f1", "m1"],
        onScreenIds: ["d1", "gone"],
        records,
      })
    ).toEqual({
      sender: "Maya",
      selected: [
        { kind: "group", id: "g1", name: "Payments" },
        {
          kind: "frame",
          id: "f1",
          name: "Checkout",
          workspace: "Pay with Apple",
        },
        { kind: "mockup", id: "m1", name: "Hero take" },
      ],
      onScreen: [{ kind: "document", id: "d1", name: "Untitled" }],
    })
  })

  it("stops each list at the limit", () => {
    const frames = Array.from({ length: CANVAS_VIEW_LIMIT + 5 }, (_, i) => ({
      id: `f${i}`,
      label: `Frame ${i}`,
    }))
    const view = describeCanvasView({
      selectedGroupIds: [],
      selectedLayerIds: [],
      onScreenIds: frames.map((f) => f.id),
      records: { ...records, frames },
    })
    expect(view.onScreen).toHaveLength(CANVAS_VIEW_LIMIT)
  })
})

describe("canvasViewSource", () => {
  it("reads the registered Canvas, and null once it unmounts", () => {
    const view = { selected: [], onScreen: [] }
    const unregister = canvasViewSource.register(() => view)
    expect(canvasViewSource.read()).toBe(view)
    unregister()
    expect(canvasViewSource.read()).toBeNull()
  })

  it("never fails a send over a broken read", () => {
    const unregister = canvasViewSource.register(() => {
      throw new Error("no DOM")
    })
    expect(canvasViewSource.read()).toBeNull()
    unregister()
  })
})
