import { describe, expect, it } from "vitest"
import {
  computeIframeLayerLayouts,
  groupContentHeight,
  groupContentWidth,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import { IFRAME_LAYER_GROUP_GAP } from "@/lib/constants"
import type {
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
} from "@/lib/types"

// Plain fixtures — no React, no Y.Doc. These mirror what
// `YjsCollection.toArray()` yields once a room has hydrated.
function layer(
  id: string,
  width: number,
  height: number,
): IframeLayerData {
  return { id, width, height, label: id, iframeState: {} }
}

function markdown(
  id: string,
  width: number,
  height: number,
): MarkdownLayerData {
  return { id, width, height, title: id }
}

function group(
  id: string,
  x: number,
  y: number,
  members: IframeLayerGroupData["members"],
  extra: Partial<IframeLayerGroupData> = {},
): IframeLayerGroupData {
  return { id, x, y, members, ...extra }
}

describe("computeIframeLayerLayouts", () => {
  it("flexes members left-to-right from the group origin with the default gap", () => {
    const g = group("g1", 100, 200, [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "b" },
    ])
    const layouts = computeIframeLayerLayouts(
      [g],
      [layer("a", 300, 400), layer("b", 150, 250)],
    )

    expect(layouts.get("a")).toEqual({
      id: "a",
      kind: "iframe-layer",
      groupId: "g1",
      index: 0,
      isLast: false,
      x: 100,
      y: 200,
      width: 300,
      height: 400,
    })
    // Second member sits one width + one default gap to the right.
    expect(layouts.get("b")).toEqual({
      id: "b",
      kind: "iframe-layer",
      groupId: "g1",
      index: 1,
      isLast: true,
      x: 100 + 300 + IFRAME_LAYER_GROUP_GAP,
      y: 200,
      width: 150,
      height: 250,
    })
  })

  it("honors a per-group gap override when advancing the cursor", () => {
    const g = group(
      "g1",
      0,
      0,
      [
        { kind: "iframe-layer", id: "a" },
        { kind: "iframe-layer", id: "b" },
      ],
      { gap: 10 },
    )
    const layouts = computeIframeLayerLayouts(
      [g],
      [layer("a", 200, 100), layer("b", 80, 60)],
    )

    expect(layouts.get("b")?.x).toBe(200 + 10)
  })

  it("places mixed iframe + markdown members and resolves each size by kind", () => {
    const g = group("g1", 0, 0, [
      { kind: "iframe-layer", id: "a" },
      { kind: "markdown-layer", id: "m" },
    ])
    const layouts = computeIframeLayerLayouts(
      [g],
      [layer("a", 100, 50)],
      [markdown("m", 40, 90)],
    )

    expect(layouts.get("m")).toMatchObject({
      kind: "markdown-layer",
      x: 100 + IFRAME_LAYER_GROUP_GAP,
      width: 40,
      height: 90,
      isLast: true,
    })
  })

  it("skips members whose underlying record is missing", () => {
    const g = group("g1", 0, 0, [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "ghost" },
    ])
    const layouts = computeIframeLayerLayouts([g], [layer("a", 100, 100)])

    expect(layouts.has("ghost")).toBe(false)
    expect(layouts.size).toBe(1)
  })

  it("derives members from the legacy iframeLayerIds field when members is empty", () => {
    const g = group("g1", 0, 0, [], { iframeLayerIds: ["a"] })
    const layouts = computeIframeLayerLayouts([g], [layer("a", 100, 100)])

    expect(layouts.get("a")).toMatchObject({ kind: "iframe-layer", x: 0 })
  })
})

describe("groupContentWidth", () => {
  it("sums member widths plus inter-member gaps", () => {
    const g = group("g1", 0, 0, [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "b" },
      { kind: "iframe-layer", id: "c" },
    ])
    const width = groupContentWidth(g, [
      layer("a", 100, 10),
      layer("b", 200, 10),
      layer("c", 50, 10),
    ])

    // 100 + 200 + 50 + two gaps between three members.
    expect(width).toBe(350 + 2 * IFRAME_LAYER_GROUP_GAP)
  })

  it("adds no gap for a single member", () => {
    const g = group("g1", 0, 0, [{ kind: "iframe-layer", id: "a" }])
    expect(groupContentWidth(g, [layer("a", 120, 10)])).toBe(120)
  })

  it("returns 0 for an empty group", () => {
    expect(groupContentWidth(group("g1", 0, 0, []), [])).toBe(0)
  })
})

describe("groupContentHeight", () => {
  it("returns the tallest member's height", () => {
    const g = group("g1", 0, 0, [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "b" },
    ])
    const height = groupContentHeight(g, [
      layer("a", 10, 300),
      layer("b", 10, 450),
    ])

    expect(height).toBe(450)
  })

  it("returns 0 for an empty group", () => {
    expect(groupContentHeight(group("g1", 0, 0, []), [])).toBe(0)
  })
})

describe("placeNewIframeLayerGroup", () => {
  it("centers the new group on the viewport when the canvas is empty", () => {
    const pos = placeNewIframeLayerGroup(
      [],
      [],
      { x: 1000, y: 500 },
      200,
      100,
    )

    expect(pos).toEqual({ x: 1000 - 100, y: 500 - 50 })
  })

  it("places to the right of the rightmost group, top-aligned with the topmost", () => {
    const groups = [
      group("g1", 0, 100, [{ kind: "iframe-layer", id: "a" }]),
      group("g2", 500, 40, [{ kind: "iframe-layer", id: "b" }]),
    ]
    const iframeLayers = [layer("a", 300, 10), layer("b", 150, 10)]

    const pos = placeNewIframeLayerGroup(
      groups,
      iframeLayers,
      { x: 0, y: 0 },
      80,
      80,
    )

    // Rightmost edge is g2.x (500) + its content width (150); topmost y is 40.
    expect(pos).toEqual({
      x: 500 + 150 + IFRAME_LAYER_GROUP_GAP,
      y: 40,
    })
  })
})
