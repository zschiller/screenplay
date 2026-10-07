import { describe, expect, it } from "vitest"
import { fileDropTarget } from "@/lib/canvas/file-placement"
import { computeIframeLayerLayouts, getGroupMembers } from "@/lib/canvas/layout"
import {
  DEFAULT_IFRAME_LAYER_HEIGHT,
  DEFAULT_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { baseDoc, makeHarness, seedGroup } from "@/test/canvas/harness"

/** Two Documents, 300 × 200, side by side in Group g at the origin. */
function twoDocs() {
  const h = makeHarness()
  h.collections.markdownLayers.set("d1", baseDoc("d1"))
  h.collections.markdownLayers.set("d2", baseDoc("d2"))
  seedGroup(h.collections, "g", [
    { kind: "markdown-layer", id: "d1" },
    { kind: "markdown-layer", id: "d2" },
  ])
  const layouts = () =>
    computeIframeLayerLayouts(
      h.collections.iframeLayerGroups.toArray(),
      h.collections.iframeLayers.toArray(),
      [
        ...h.collections.markdownLayers.toArray(),
        ...h.collections.mockupLayers.toArray(),
      ]
    )
  return { ...h, layouts }
}

describe("fileDropTarget (#1887)", () => {
  it("joins the Group under the point at the gap nearest it", () => {
    const { layouts } = twoDocs()
    const d2 = layouts().get("d2")!
    expect(fileDropTarget(layouts().values(), { x: 10, y: 10 })).toEqual({
      groupId: "g",
      index: 0,
    })
    expect(fileDropTarget(layouts().values(), { x: 200, y: 10 })).toEqual({
      groupId: "g",
      index: 1,
    })
    expect(
      fileDropTarget(layouts().values(), { x: d2.x + d2.width - 5, y: 100 })
    ).toEqual({ groupId: "g", index: 2 })
  })

  it("is empty canvas past the Group's members", () => {
    const { layouts } = twoDocs()
    expect(fileDropTarget(layouts().values(), { x: 10, y: 400 })).toBeNull()
    expect(fileDropTarget(layouts().values(), { x: -10, y: 10 })).toBeNull()
  })
})

describe("placeFileAt (#1887)", () => {
  it("puts a view into the Group at the index it was dropped at", () => {
    const { ops, collections } = twoDocs()
    const fileId = ops.createFile({ kind: "document", title: "Brief" })
    const placed = ops.placeFileAt(fileId, { groupId: "g", index: 1 })!
    expect(placed.groupId).toBe("g")
    expect(
      getGroupMembers(collections.iframeLayerGroups.get("g")!).map((m) => m.id)
    ).toEqual(["d1", placed.viewId, "d2"])
    expect(collections.markdownLayers.get(placed.viewId)?.fileId).toBe(fileId)
  })

  it("starts its own Group centred on the point on empty canvas", () => {
    const { ops, collections } = twoDocs()
    const fileId = ops.createFile({ kind: "mockup", title: "Option B" })
    const placed = ops.placeFileAt(fileId, { x: 2000, y: 1000 })!
    const group = collections.iframeLayerGroups.get(placed.groupId)!
    expect(getGroupMembers(group)).toEqual([
      { kind: "mockup-layer", id: placed.viewId },
    ])
    expect(group.x).toBe(2000 - DEFAULT_IFRAME_LAYER_WIDTH / 2)
    expect(group.y).toBe(1000 - DEFAULT_IFRAME_LAYER_HEIGHT / 2)
  })

  it("takes the size of the file's first view", () => {
    const { ops, collections } = twoDocs()
    const fileId = ops.createFile({ kind: "document", title: "Brief" })
    const first = ops.placeFileAt(fileId, { groupId: "g", index: 0 })!
    collections.markdownLayers.update(first.viewId, { width: 640 })
    expect(ops.fileViewSize(fileId)?.width).toBe(640)
    const second = ops.placeFileAt(fileId, { x: 0, y: 900 })!
    expect(collections.markdownLayers.get(second.viewId)?.width).toBe(640)
  })

  it("does nothing for a file that's gone", () => {
    const { ops } = twoDocs()
    expect(ops.placeFileAt("gone", { x: 0, y: 0 })).toBeUndefined()
  })
})
