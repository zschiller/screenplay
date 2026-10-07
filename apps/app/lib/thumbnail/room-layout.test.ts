import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  MockupLayerData,
  PageData,
} from "@/lib/types"

// `readRoomCaptureLayout` reads the room Y.Doc through the Room's reader; stub
// it so the test drives the frame-building logic with plain fixtures instead of
// a Yjs round-trip. `computeIframeLayerLayouts` runs for real, so a member only
// gets a layout when it actually sits in a group.
const readDoc = vi.fn()
const ROOM = { roomId: "room-1", readDoc }

import { readRoomCaptureLayout } from "./room-layout"
import { mockupHtml, writeMockupHtml } from "@/lib/yjs/mockup-html"

/** Wire the stubbed doc read to a fake collections snapshot. */
function withDoc(snapshot: {
  branches?: Map<string, BranchData>
  iframeLayers?: IframeLayerData[]
  markdownLayers?: MarkdownLayerData[]
  mockupLayers?: MockupLayerData[]
  groups?: IframeLayerGroupData[]
  pages?: PageData[]
  doc?: Y.Doc
}) {
  readDoc.mockImplementation((fn: (c: unknown) => unknown) =>
    Promise.resolve(
      fn({
        doc: snapshot.doc ?? new Y.Doc(),
        branches: { toMap: () => snapshot.branches ?? new Map() },
        iframeLayers: { toArray: () => snapshot.iframeLayers ?? [] },
        markdownLayers: { toArray: () => snapshot.markdownLayers ?? [] },
        mockupLayers: { toArray: () => snapshot.mockupLayers ?? [] },
        iframeLayerGroups: { toArray: () => snapshot.groups ?? [] },
        pages: { toArray: () => snapshot.pages ?? [] },
      })
    )
  )
}

function iframeLayer(
  over: Partial<IframeLayerData> & { id: string }
): IframeLayerData {
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

    const { frames, layouts } = await readRoomCaptureLayout(ROOM)

    // The document layer is placed in the layout alongside the iframe layer...
    expect(layouts.has("d1")).toBe(true)
    // ...and shows up as a frame labeled by its title, with nothing to capture.
    const doc = frames.find((f) => f.id === "d1")
    expect(doc).toEqual({
      id: "d1",
      label: "Spec",
      previewUrl: null,
    })
  })

  it("places an empty mockup layer as a captureless placeholder labeled by its title", async () => {
    withDoc({
      mockupLayers: [{ id: "m1", width: 300, height: 200, title: "Option A" }],
      groups: [
        { id: "g1", x: 0, y: 0, members: [{ kind: "mockup-layer", id: "m1" }] },
      ],
    })

    const { frames, layouts } = await readRoomCaptureLayout(ROOM)

    expect(layouts.get("m1")).toMatchObject({ width: 300, height: 200 })
    expect(frames).toEqual([{ id: "m1", label: "Option A", previewUrl: null }])
  })

  it("hands a mockup layer's page from before folders to the capture", async () => {
    const doc = new Y.Doc()
    writeMockupHtml(mockupHtml(doc, "m1"), "<h1>Option A</h1>")
    withDoc({
      doc,
      mockupLayers: [{ id: "m1", width: 300, height: 200, title: "Option A" }],
      groups: [
        { id: "g1", x: 0, y: 0, members: [{ kind: "mockup-layer", id: "m1" }] },
      ],
    })

    const { frames } = await readRoomCaptureLayout(ROOM)

    expect(frames).toEqual([
      {
        id: "m1",
        label: "Option A",
        previewUrl: null,
        mockupFileId: "m1",
      },
    ])
  })

  it("hands a mockup layer with a folder to the capture (#1886)", async () => {
    withDoc({
      mockupLayers: [
        { id: "m1", width: 300, height: 200, title: "Option A", revision: 2 },
      ],
      groups: [
        { id: "g1", x: 0, y: 0, members: [{ kind: "mockup-layer", id: "m1" }] },
      ],
    })

    const { frames } = await readRoomCaptureLayout(ROOM)

    expect(frames).toEqual([
      { id: "m1", label: "Option A", previewUrl: null, mockupFileId: "m1" },
    ])
  })

  it("keeps iframe-layer frames bound to their Branch's preview URL", async () => {
    withDoc({
      branches: new Map([
        ["b1", { previewDomain: "https://b1.example" } as BranchData],
      ]),
      iframeLayers: [
        iframeLayer({
          id: "a1",
          label: "Frame",
          branchId: "b1",
          route: "/home",
        }),
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

    const { frames } = await readRoomCaptureLayout(ROOM)

    expect(frames.find((f) => f.id === "a1")).toEqual({
      id: "a1",
      label: "Frame",
      previewUrl: "https://b1.example/home",
    })
  })

  describe("with several pages", () => {
    // One frame per page: a1 on Site, a2 on Explorations.
    const layers = [
      iframeLayer({ id: "a1", label: "Home" }),
      iframeLayer({ id: "a2", label: "Option A" }),
    ]
    const groups: IframeLayerGroupData[] = [
      {
        id: "g1",
        x: 0,
        y: 0,
        pageId: "page-1",
        members: [{ kind: "iframe-layer", id: "a1" }],
      },
      {
        id: "g2",
        x: 500,
        y: 0,
        pageId: "p2",
        members: [{ kind: "iframe-layer", id: "a2" }],
      },
    ]

    it("lays out only the first page's layers", async () => {
      withDoc({
        iframeLayers: layers,
        groups,
        pages: [
          { id: "page-1", name: "Site", order: 0 },
          { id: "p2", name: "Explorations", order: 1 },
        ],
      })

      const { layouts } = await readRoomCaptureLayout(ROOM)

      expect([...layouts.keys()]).toEqual(["a1"])
    })

    it("follows the page order, so reordering changes the cover", async () => {
      withDoc({
        iframeLayers: layers,
        groups,
        pages: [
          { id: "page-1", name: "Site", order: 1 },
          { id: "p2", name: "Explorations", order: 0 },
        ],
      })

      const { layouts } = await readRoomCaptureLayout(ROOM)

      expect([...layouts.keys()]).toEqual(["a2"])
    })
  })
})
