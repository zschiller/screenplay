import { describe, expect, it } from "vitest"
import { CANVAS_OPS_ORIGIN } from "@/lib/canvas/ops"
import {
  baseLayer,
  findEmptyGroups,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

describe("batch", () => {
  it("commits its writes in one transaction tagged with the canvas-ops origin", () => {
    const { doc, ops, collections } = makeHarness()
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.batch(() => {
      collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    })

    // One committed transaction carrying the uniform origin — what a future
    // Y.UndoManager keys off of.
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
    expect(collections.iframeLayers.get("layer-1")?.id).toBe("layer-1")
  })
})

describe("patch", () => {
  it("merges fields onto an existing record without clobbering siblings", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { label: "Home" })
    )

    ops.patch("iframeLayers", "layer-1", { scrollX: 10, scrollY: 20 })

    const layer = collections.iframeLayers.get("layer-1")
    expect(layer?.scrollX).toBe(10)
    expect(layer?.scrollY).toBe(20)
    // Untouched fields survive the merge.
    expect(layer?.label).toBe("Home")
    expect(layer?.width).toBe(400)
  })

  it("commits under the canvas-ops origin", () => {
    const { doc, ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.patch("iframeLayers", "layer-1", { label: "Renamed" })

    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })

  it("is a no-op when the record does not exist", () => {
    const { ops, collections } = makeHarness()

    ops.patch("iframeLayers", "missing", { label: "ghost" })

    expect(collections.iframeLayers.has("missing")).toBe(false)
  })
})

describe("pruneIfEmpty (Group invariant chokepoint)", () => {
  it("deletes a Group once its last Member has been removed", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "group-1", [])

    ops.internal.pruneIfEmpty("group-1")

    expect(collections.iframeLayerGroups.has("group-1")).toBe(false)
  })

  it("leaves a Group that still holds Members untouched", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    ops.internal.pruneIfEmpty("group-1")

    expect(collections.iframeLayerGroups.has("group-1")).toBe(true)
  })
})

describe("findEmptyGroups (invariant sweep)", () => {
  it("reports nothing for a healthy doc", () => {
    const { collections } = makeHarness()
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("flags a committed Group that holds zero Members", () => {
    const { collections } = makeHarness()
    seedGroup(collections, "group-empty", [])
    seedGroup(collections, "group-ok", [{ kind: "iframe-layer", id: "layer-1" }])

    expect(findEmptyGroups(collections)).toEqual(["group-empty"])
  })
})
