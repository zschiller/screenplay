import { describe, expect, it, vi } from "vitest"

import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
} from "@/lib/types"

// `readRoomCaptureLayout` reads the room Y.Doc through this one seam; stub it so
// the test drives the frame-building logic with plain fixtures instead of a Yjs
// round-trip. `computeIframeLayerLayouts` runs for real, so a member only gets a
// layout when it actually sits in a group.
const { readRoomDoc } = vi.hoisted(() => ({ readRoomDoc: vi.fn() }))
vi.mock("@/lib/yjs/server", () => ({ readRoomDoc }))

import { readRoomCaptureLayout } from "./room-layout"

/** Wire the stubbed doc read to a fake collections snapshot. */
function withDoc(snapshot: {
  branches?: Map<string, BranchData>
  iframeLayers?: IframeLayerData[]
  markdownLayers?: MarkdownLayerData[]
  groups?: IframeLayerGroupData[]
}) {
  readRoomDoc.mockImplementation(
    (_roomId: string, fn: (c: unknown) => unknown) =>
      Promise.resolve(
        fn({
          branches: { toMap: () => snapshot.branches ?? new Map() },
          iframeLayers: { toArray: () => snapshot.iframeLayers ?? [] },
          markdownLayers: { toArray: () => snapshot.markdownLayers ?? [] },
          iframeLayerGroups: { toArray: () => snapshot.groups ?? [] },
        })
      )
  )
}

function iframeLayer(over: Partial<IframeLayerData> & { id: string }): IframeLayerData {
  return { width: 100, height: 100, label: "", iframeState: {}, ...over }
}

function markdownLayer(
  over: Partial<MarkdownLayerData> & { id: string }
): MarkdownLayerData {
  return { width: 100, height: 100, title: "", ...over }
}

describe("readRoomCaptureLayout", () => {
  it("emits a captureless, Branch-less placeholder frame for each markdown (document) layer", async () => {
    withDoc({
      iframeLayers: [iframeLayer({ id: "a1", label: "Frame" })],
      markdownLayers: [markdownLayer({ id: "d1", title: "Spec" })],
      groups: [
        {
          id: "g1",
          x: 0,
          y: 0,
          members: [
            { kind: "iframe-layer", id: "a1" },
            { kind: "markdown-layer", id: "d1" },
          ],
        },
      ],
    })

    const { frames, layouts } = await readRoomCaptureLayout("room-1")

    // The document layer is placed in the layout alongside the iframe layer...
    expect(layouts.has("d1")).toBe(true)
    // ...and shows up as a frame labeled by its title, with nothing to capture.
    const doc = frames.find((f) => f.id === "d1")
    expect(doc).toEqual({
      id: "d1",
      label: "Spec",
      previewUrl: null,
      branchKey: null,
    })
  })

  it("keeps iframe-layer frames bound to their Branch's preview URL and palette", async () => {
    withDoc({
      branches: new Map([
        ["b1", { previewDomain: "https://b1.example", colorIndex: 3 } as BranchData],
      ]),
      iframeLayers: [
        iframeLayer({ id: "a1", label: "Frame", branchId: "b1", route: "/home" }),
      ],
      markdownLayers: [markdownLayer({ id: "d1", title: "Spec" })],
      groups: [
        {
          id: "g1",
          x: 0,
          y: 0,
          members: [
            { kind: "iframe-layer", id: "a1" },
            { kind: "markdown-layer", id: "d1" },
          ],
        },
      ],
    })

    const { frames } = await readRoomCaptureLayout("room-1")

    expect(frames.find((f) => f.id === "a1")).toEqual({
      id: "a1",
      label: "Frame",
      previewUrl: "https://b1.example/home",
      branchKey: "b1",
      branchColorIndex: 3,
    })
  })
})
