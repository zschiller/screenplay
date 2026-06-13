import { describe, expect, it } from "vitest"

import type { IframeLayerLayout } from "@/lib/canvas/layout"
import { buildThumbnailManifest, type FrameCapture } from "./manifest"

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

describe("buildThumbnailManifest", () => {
  it("places each iframe layer at its computed rect and label", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
      ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [
        { id: "a", label: "Home" },
        { id: "b", label: "Settings" },
      ],
      new Map()
    )

    expect(manifest.version).toBe(1)
    expect(manifest.frames).toEqual([
      { id: "a", label: "Home", x: 0, y: 0, width: 400, height: 300, capture: null },
      {
        id: "b",
        label: "Settings",
        x: 420,
        y: 0,
        width: 400,
        height: 300,
        capture: null,
      },
    ])
  })

  it("attaches a Frame Capture where one exists, leaving the rest null", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
      ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
    ])
    const captures = new Map<string, FrameCapture>([
      ["a", { url: "https://blob.example/thumbnails/room-1/a.webp" }],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [
        { id: "a", label: "Home" },
        { id: "b", label: "Settings" },
      ],
      captures
    )

    expect(manifest.frames[0]!.capture).toEqual({
      url: "https://blob.example/thumbnails/room-1/a.webp",
    })
    expect(manifest.frames[1]!.capture).toBeNull()
  })

  it("computes bounds as the union of every placed frame's rect", () => {
    const layouts = new Map([
      ["a", layout("a", { x: 10, y: 20, width: 400, height: 300 })],
      ["b", layout("b", { x: 430, y: 20, width: 200, height: 500 })],
    ])
    const manifest = buildThumbnailManifest(
      layouts,
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
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
      [
        { id: "a", label: "Placed" },
        { id: "orphan", label: "Unplaced" },
      ],
      new Map()
    )

    expect(manifest.frames.map((f) => f.id)).toEqual(["a"])
  })

  it("returns an empty manifest with a zero-bounds rect when nothing is placed", () => {
    const manifest = buildThumbnailManifest(new Map(), [], new Map())
    expect(manifest.frames).toEqual([])
    expect(manifest.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
