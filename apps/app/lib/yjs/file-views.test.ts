import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { roomMentionLabels } from "@/lib/document-markdown"
import { fileIdOf, findViewOrFile, layerFileOf } from "@/lib/yjs/file-views"
import {
  COLLECTION_KEYS,
  createRoomCollections,
  getRoomCollections,
} from "@/lib/yjs/schema"

/** A room doc as it was before files (#1883): each layer carries it all. */
function legacyDoc() {
  const doc = new Y.Doc()
  const put = (key: string, id: string, fields: Record<string, unknown>) => {
    const entry = new Y.Map<unknown>()
    doc.getMap<Y.Map<unknown>>(key).set(id, entry)
    for (const [k, v] of Object.entries(fields)) entry.set(k, v)
  }
  put(COLLECTION_KEYS.markdownLayers, "doc-1", {
    id: "doc-1",
    width: 480,
    height: 640,
    title: "Plan",
    lastChangedByChatId: "chat-1",
  })
  put(COLLECTION_KEYS.mockupLayers, "mock-1", {
    id: "mock-1",
    width: 400,
    height: 300,
    title: "Hero",
    ownerChatId: "chat-2",
    knobs: [{ id: "tone" }],
    knobValues: { tone: "warm" },
    scrollY: 120,
    fitHeight: true,
  })
  return doc
}

const raw = (doc: Y.Doc, key: string, id: string) =>
  doc.getMap<Y.Map<unknown>>(key).get(id)?.toJSON()

describe("the files and views migration (#1883)", () => {
  it("turns each Document and Mockup into a file plus one view under the same id", () => {
    const doc = legacyDoc()
    const c = getRoomCollections(doc)

    expect(c.layerFiles.get("doc-1")).toEqual({
      id: "doc-1",
      kind: "document",
      title: "Plan",
      lastChangedByChatId: "chat-1",
    })
    expect(c.layerFiles.get("mock-1")).toEqual({
      id: "mock-1",
      kind: "mockup",
      title: "Hero",
      ownerChatId: "chat-2",
      knobs: [{ id: "tone" }],
      knobValues: { tone: "warm" },
    })
    expect(raw(doc, COLLECTION_KEYS.markdownLayers, "doc-1")).toEqual({
      id: "doc-1",
      fileId: "doc-1",
      width: 480,
      height: 640,
    })
    expect(raw(doc, COLLECTION_KEYS.mockupLayers, "mock-1")).toEqual({
      id: "mock-1",
      fileId: "mock-1",
      width: 400,
      height: 300,
      scrollY: 120,
      fitHeight: true,
    })
  })

  it("reads every layer as it read before, so nothing visibly changes", () => {
    const before = createRoomCollections(legacyDoc())
    const after = getRoomCollections(legacyDoc())

    expect(after.markdownLayers.toArray()).toEqual(
      before.markdownLayers.toArray()
    )
    expect(after.mockupLayers.get("mock-1")).toEqual(
      before.mockupLayers.get("mock-1")
    )
    expect(after.mockupLayers.get("mock-1")).toMatchObject({
      title: "Hero",
      knobValues: { tone: "warm" },
      scrollY: 120,
    })
  })

  it("is a no-op once every layer is split", () => {
    const doc = legacyDoc()
    getRoomCollections(doc)
    const updates: Uint8Array[] = []
    doc.on("update", (u: Uint8Array) => updates.push(u))

    createRoomCollections(doc)
    getRoomCollections(doc)

    expect(updates).toEqual([])
  })

  it("splits a layer not migrated yet on its first write", () => {
    const doc = legacyDoc()
    const c = createRoomCollections(doc)

    c.markdownLayers.update("doc-1", { title: "Plan B", width: 500 })

    expect(c.layerFiles.get("doc-1")?.title).toBe("Plan B")
    expect(raw(doc, COLLECTION_KEYS.markdownLayers, "doc-1")).toEqual({
      id: "doc-1",
      fileId: "doc-1",
      width: 500,
      height: 640,
    })
  })
})

/** A Document file with two views, as a later Add to canvas will make. */
function twoViews() {
  const doc = new Y.Doc()
  const c = getRoomCollections(doc)
  c.markdownLayers.set("view-a", {
    id: "view-a",
    fileId: "file-1",
    width: 480,
    height: 640,
    title: "Plan",
  })
  c.markdownLayers.addView("view-b", "file-1", { width: 300, height: 200 })
  c.markdownLayers.set("other", {
    id: "other",
    width: 480,
    height: 640,
    title: "Notes",
  })
  return { doc, c }
}

describe("views of one file", () => {
  it("read the file's fields and keep their own size", () => {
    const { c } = twoViews()

    expect(c.markdownLayers.get("view-b")).toEqual({
      id: "view-b",
      fileId: "file-1",
      width: 300,
      height: 200,
      title: "Plan",
    })
    expect(c.markdownLayers.viewIdsOf("file-1")).toEqual(["view-a", "view-b"])
  })

  it("both repaint when the file changes through either", () => {
    const { c } = twoViews()
    let changes = 0
    const stop = c.markdownLayers.observe(() => changes++)
    const [, , other] = c.markdownLayers.toArray()

    c.markdownLayers.update("view-b", { title: "Plan B" })

    expect(changes).toBe(1)
    expect(c.markdownLayers.get("view-a")?.title).toBe("Plan B")
    const after = c.markdownLayers.toMap()
    expect(after.get("view-a")?.title).toBe("Plan B")
    expect(after.get("view-b")?.title).toBe("Plan B")
    // A view of another file keeps its object.
    expect(after.get("other")).toBe(other)
    stop()
  })

  it("resize one view without touching the other", () => {
    const { c } = twoViews()

    c.markdownLayers.update("view-b", { width: 360 })

    expect(c.markdownLayers.get("view-a")?.width).toBe(480)
    expect(c.markdownLayers.get("view-b")?.width).toBe(360)
  })

  it("keep the file while a view is left, and take it with the last", () => {
    const { c } = twoViews()

    c.markdownLayers.delete("view-a")
    expect(c.layerFiles.get("file-1")?.title).toBe("Plan")
    expect(c.markdownLayers.get("view-b")?.title).toBe("Plan")

    c.markdownLayers.delete("view-b")
    expect(c.layerFiles.has("file-1")).toBe(false)
  })
})

describe("resolving an id to its file", () => {
  it("takes a view's id or the file's", () => {
    const { c } = twoViews()

    expect(fileIdOf(c, "view-b")).toBe("file-1")
    expect(fileIdOf(c, "file-1")).toBe("file-1")
    expect(fileIdOf(c, "gone")).toBe(undefined)
    expect(layerFileOf(c, "view-a")?.title).toBe("Plan")
    expect(layerFileOf(c, "file-1")?.kind).toBe("document")
  })

  it("reads a layer not migrated yet off the layer", () => {
    const c = createRoomCollections(legacyDoc())

    expect(layerFileOf(c, "mock-1")).toMatchObject({
      id: "mock-1",
      kind: "mockup",
      title: "Hero",
    })
  })

  it("names mentions and refs by the file", () => {
    const { c } = twoViews()
    const labelOf = roomMentionLabels(c)

    expect(labelOf("markdown-layer", "file-1")).toBe("Plan")
    expect(labelOf("markdown-layer", "view-b")).toBe("Plan")
    expect(labelOf("mockup-layer", "file-1")).toBe(undefined)
    expect(findViewOrFile(c.markdownLayers.toArray(), "file-1")?.id).toBe(
      "view-a"
    )
  })
})
