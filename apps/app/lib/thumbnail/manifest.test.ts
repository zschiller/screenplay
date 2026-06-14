import { describe, expect, it } from "vitest"

import type { IframeLayerLayout } from "@/lib/canvas/layout"
import { resolveBranchColorIndex } from "@/lib/branch-colors"
import {
  buildThumbnailManifest,
  type FrameCapture,
  type ManifestLayer,
} from "./manifest"

/** A layout-map entry with sensible defaults for the fields the manifest ignores. */
function layout(
  id: string,
  rect: { x: number; y: number; width: number; height: number }
): IframeLayerLayout {
  return {
    id,
    kind: "iframe-layer",
    groupId: "g1",
    index: 0,
    isLast: true,
    ...rect,
  }
}

/** A layer input bound to a Branch, with the palette fields overridable. */
function input(
  id: string,
  label: string,
  branch?: Partial<Pick<ManifestLayer, "branchKey" | "branchColorIndex">>
): ManifestLayer {
  return { id, label, branchKey: `branch-${id}`, ...branch }
}

/** A fresh capture for `id`, captured at `capturedAt`. */
function capture(id: string, capturedAt: number): FrameCapture {
  return {
    url: `https://blob.example/thumbnails/room-1/${id}.webp`,
    capturedAt,
  }
}

describe("buildThumbnailManifest", () => {
  it("places each iframe layer at its computed rect and label", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
      ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [input("a", "Home"), input("b", "Settings")],
      new Map()
    )

    expect(manifest.version).toBe(2)
    expect(manifest.frames).toEqual([
      {
        id: "a",
        label: "Home",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        paletteIndex: resolveBranchColorIndex("branch-a"),
        capture: null,
      },
      {
        id: "b",
        label: "Settings",
        x: 420,
        y: 0,
        width: 400,
        height: 300,
        paletteIndex: resolveBranchColorIndex("branch-b"),
        capture: null,
      },
    ])
  })

  it("attaches a Frame Capture where one exists, leaving the rest null", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
      ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
    ])
    const captures = new Map<string, FrameCapture>([["a", capture("a", 1000)]])
    const manifest = buildThumbnailManifest(
      layouts,
      [input("a", "Home"), input("b", "Settings")],
      captures
    )

    expect(manifest.frames[0]!.capture).toEqual(capture("a", 1000))
    expect(manifest.frames[1]!.capture).toBeNull()
  })

  it("snapshots a Branch's manual palette override over the hash", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [input("a", "Home", { branchKey: "branch-a", branchColorIndex: 7 })],
      new Map()
    )

    expect(manifest.frames[0]!.paletteIndex).toBe(7)
  })

  it("snapshots the hashed palette index when the Branch has no override", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [input("a", "Home", { branchKey: "feature-login" })],
      new Map()
    )

    expect(manifest.frames[0]!.paletteIndex).toBe(
      resolveBranchColorIndex("feature-login")
    )
  })

  it("snapshots a null palette index for a frame bound to no Branch", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [{ id: "a", label: "Empty frame", branchKey: null }],
      new Map()
    )

    expect(manifest.frames[0]!.paletteIndex).toBeNull()
  })

  it("computes bounds as the union of every placed frame's rect", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 10, y: 20, width: 400, height: 300 })],
      ["b", layout("b", { x: 430, y: 20, width: 200, height: 500 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [input("a", "A"), input("b", "B")],
      new Map()
    )

    // minX=10, minY=20, maxX=630, maxY=520
    expect(manifest.bounds).toEqual({ x: 10, y: 20, width: 620, height: 500 })
  })

  it("skips layers with no computed layout (not in any group)", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [input("a", "Placed"), input("orphan", "Unplaced")],
      new Map()
    )

    expect(manifest.frames.map((f) => f.id)).toEqual(["a"])
  })

  it("returns an empty manifest with a zero-bounds rect when nothing is placed", () => {
    const manifest = buildThumbnailManifest(new Map(), [], new Map())
    expect(manifest.frames).toEqual([])
    expect(manifest.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it("bumps the revision off the previous manifest on every rebuild", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
    ])
    // First build (no previous) lands at revision 1.
    const first = buildThumbnailManifest(layouts, [input("a", "Home")], new Map())
    expect(first.revision).toBe(1)

    // A layout-only rebuild (no fresh captures) still advances the revision, so
    // the home grid's poll-merge sees the moved frame.
    const second = buildThumbnailManifest(
      layouts,
      [input("a", "Home")],
      new Map(),
      first
    )
    expect(second.revision).toBe(2)
  })

  describe("merge / prune / retain / reposition across rounds", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
      ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
    ])
    const previous = buildThumbnailManifest(
      layouts,
      [input("a", "Home"), input("b", "Settings")],
      new Map<string, FrameCapture>([
        ["a", capture("a", 1000)],
        ["b", capture("b", 1000)],
      ])
    )

    it("merge: a fresh capture overwrites only that layer's image + timestamp", () => {
      const next = buildThumbnailManifest(
        layouts,
        [input("a", "Home"), input("b", "Settings")],
        new Map<string, FrameCapture>([["a", capture("a", 2000)]]),
        previous
      )

      // `a` adopts the new capture; `b` is untouched, keeping its prior one.
      expect(next.frames[0]!.capture).toEqual(capture("a", 2000))
      expect(next.frames[1]!.capture).toEqual(capture("b", 1000))
    })

    it("retain: a layer with no fresh capture keeps its last-good image", () => {
      // A round that captures nothing (every preview booting/failing) must not
      // revert either frame to a placeholder.
      const next = buildThumbnailManifest(
        layouts,
        [input("a", "Home"), input("b", "Settings")],
        new Map(),
        previous
      )

      expect(next.frames[0]!.capture).toEqual(capture("a", 1000))
      expect(next.frames[1]!.capture).toEqual(capture("b", 1000))
    })

    it("retain only goes so far: a never-captured layer stays captureless", () => {
      const next = buildThumbnailManifest(
        new Map([
          ...layouts,
          ["c", layout("c", { x: 840, y: 0, width: 400, height: 300 })],
        ]),
        [input("a", "Home"), input("b", "Settings"), input("c", "New")],
        new Map(),
        previous
      )

      expect(next.frames.find((f) => f.id === "c")!.capture).toBeNull()
    })

    it("prune: a layer removed from the canvas drops out of the rebuild", () => {
      const next = buildThumbnailManifest(
        new Map([["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })]]),
        [input("a", "Home")],
        new Map(),
        previous
      )

      // `b`'s retained capture is gone with it — no orphaned frame lingers.
      expect(next.frames.map((f) => f.id)).toEqual(["a"])
    })

    it("reposition: a moved/resized frame reflects new geometry on next capture", () => {
      const moved = new Map([
        ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
        // `b` was dragged down-right and resized.
        ["b", layout("b", { x: 500, y: 600, width: 800, height: 450 })],
      ])
      const next = buildThumbnailManifest(
        moved,
        [input("a", "Home"), input("b", "Settings")],
        new Map<string, FrameCapture>([["b", capture("b", 2000)]]),
        previous
      )

      expect(next.frames[1]).toMatchObject({
        id: "b",
        x: 500,
        y: 600,
        width: 800,
        height: 450,
      })
      // Bounds widen to the union of the new geometry.
      expect(next.bounds).toEqual({ x: 0, y: 0, width: 1300, height: 1050 })
    })

    it("re-snapshots label and palette index from the current layout while retaining the image", () => {
      const next = buildThumbnailManifest(
        layouts,
        [
          // `a` was renamed and recolored on the canvas; no new capture this round.
          input("a", "Dashboard", { branchColorIndex: 9 }),
          input("b", "Settings"),
        ],
        new Map(),
        previous
      )

      expect(next.frames[0]).toMatchObject({
        label: "Dashboard",
        paletteIndex: 9,
        // ...while still carrying the retained image.
        capture: capture("a", 1000),
      })
    })
  })
})
