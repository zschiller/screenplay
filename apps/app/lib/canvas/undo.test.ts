import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { addMemory, removeMemory } from "@/lib/memory/canvas"
import { createCanvasUndo } from "@/lib/canvas/undo"
import { createCanvasOps } from "@/lib/canvas/ops"
import { COLLECTION_KEYS, createRoomCollections } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseLayer,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

/** A canvas with one Group holding two frames and a document a chat wrote. */
function canvas() {
  const h = makeHarness()
  const { collections } = h
  collections.branches.set("ws-1", baseBranch("ws-1"))
  collections.iframeLayers.set("frame-1", baseLayer("frame-1"))
  collections.iframeLayers.set("frame-2", baseLayer("frame-2"))
  collections.markdownLayers.set(
    "doc-1",
    baseDoc("doc-1", { lastChangedByChatId: "chat-1" })
  )
  collections.chatSessions.set(
    "chat-1",
    baseChat("chat-1", { branchId: "ws-1" })
  )
  seedGroup(collections, "group-1", [
    { kind: "iframe-layer", id: "frame-1" },
    { kind: "iframe-layer", id: "frame-2" },
    { kind: "markdown-layer", id: "doc-1" },
  ])
  // Created after seeding, as the canvas mounts after the room loads.
  const undo = createCanvasUndo(h.doc)
  return { ...h, undo }
}

describe("⌘Z", () => {
  it("undoes and redoes a canvas edit", () => {
    const { ops, collections, undo } = canvas()
    ops.patch("iframeLayerGroups", "group-1", { x: 200 })

    undo.undo()
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(0)
    undo.redo()
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(200)
  })

  it("brings a deleted frame back into its Group", () => {
    const { ops, collections, undo } = canvas()
    ops.removeLayers(["frame-1"])

    undo.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(true)
    expect(
      collections.iframeLayerGroups.get("group-1")?.members.map((m) => m.id)
    ).toEqual(["frame-1", "frame-2", "doc-1"])
  })

  it("brings a deleted document back with its last chat", () => {
    const { ops, collections, undo } = canvas()
    ops.removeDocuments(["doc-1"])
    expect(collections.chatSessions.has("chat-1")).toBe(true)

    undo.undo()
    expect(collections.markdownLayers.get("doc-1")?.lastChangedByChatId).toBe(
      "chat-1"
    )
  })

  it("skips what a running prototype reports on its frame", () => {
    const { ops, collections, undo } = canvas()
    ops.patch("iframeLayers", "frame-1", { width: 800 })
    ops.patch("iframeLayers", "frame-1", { scrollX: 0, scrollY: 400 })
    ops.navigateRoute("frame-1", "/cart", { cloneTrail: false })

    undo.undo()
    expect(collections.iframeLayers.get("frame-1")).toMatchObject({
      width: 400,
      scrollY: 400,
      route: "/cart",
    })
  })

  it("skips chat, plan and Workspace writes", () => {
    const { ops, collections, undo } = canvas()
    ops.patch("iframeLayerGroups", "group-1", { x: 200 })
    ops.patch("chatSessions", "chat-1", { label: "Renamed" })
    ops.patch("branches", "ws-1", { status: "running" })

    undo.undo()
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(0)
    expect(collections.chatSessions.get("chat-1")?.label).toBe("Renamed")
    expect(collections.branches.get("ws-1")?.status).toBe("running")
  })

  it("doesn't undo removing a Workspace, which keeps its confirm", () => {
    const { ops, collections, undo } = canvas()
    ops.assignBranch("frame-1", "ws-1")
    ops.removeBranch("ws-1")

    undo.undo()
    expect(collections.branches.has("ws-1")).toBe(false)
    expect(collections.iframeLayers.has("frame-1")).toBe(false)
  })

  it("doesn't undo another member's or the Coordinator's edits", () => {
    const { doc, collections, undo } = canvas()
    // Everything from the server arrives with the provider as its origin.
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc))
    const sv = Y.encodeStateVector(server)
    server.getMap(COLLECTION_KEYS.iframeLayers).delete("frame-1")
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, sv), "provider")
    expect(collections.iframeLayers.has("frame-1")).toBe(false)

    undo.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(false)
  })
})

describe("⌘Z on a Mockup (#1309)", () => {
  /** A Mockup a chat drew: it arrives from the server, like any chat write. */
  function withChatMockup() {
    const h = canvas()
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(h.doc))
    const sv = Y.encodeStateVector(server)
    const serverOps = createCanvasOps(createRoomCollections(server))
    const { mockupId } = serverOps.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!
    createRoomCollections(server).mockupLayers.update(mockupId, {
      revision: 1,
    })
    Y.applyUpdate(h.doc, Y.encodeStateAsUpdate(server, sv), "provider")
    return { ...h, mockupId, server, serverOps }
  }

  it("never undoes the chat's create or update", () => {
    const { doc, collections, undo, mockupId, server, serverOps } =
      withChatMockup()
    const sv = Y.encodeStateVector(server)
    serverOps.updateMockup(mockupId, { title: "Option B" })
    // A write to its folder bumps the revision (#1886), from the server too.
    createRoomCollections(server).mockupLayers.update(mockupId, {
      revision: 2,
    })
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, sv), "provider")

    undo.undo()
    expect(collections.mockupLayers.get(mockupId)).toMatchObject({
      title: "Option B",
      revision: 2,
    })
  })

  it("brings a deleted Mockup back with its folder's revision and its chat", () => {
    const { ops, collections, undo, mockupId } = withChatMockup()
    ops.removeMockups([mockupId])

    undo.undo()
    expect(collections.mockupLayers.get(mockupId)).toMatchObject({
      lastChangedByChatId: "chat-2",
      revision: 1,
    })
  })

  it("keeps a deleted Mockup's folder while ⌘Z could bring it back, and lets it go with Undo (#1886)", () => {
    const { doc, ops, undo, mockupId } = withChatMockup()
    // Removing the last view keeps the file (#1884): nothing to let go.
    ops.removeMockups([mockupId])
    expect(undo.deletedMockupFiles()).toEqual([])
    undo.undo()

    ops.deleteFiles([mockupId])
    expect(undo.deletedMockupFiles()).toEqual([mockupId])

    undo.undo()
    expect(undo.deletedMockupFiles()).toEqual([])
    undo.redo()
    expect(undo.deletedMockupFiles()).toEqual([mockupId])

    const gone: string[][] = []
    const second = createCanvasUndo(doc, {
      onMockupFilesGone: (ids) => gone.push(ids),
    })
    second.destroy()
    // Only the Undo that deleted it lets it go.
    expect(gone).toEqual([])
  })

  it("lets go of nothing another member deleted", () => {
    const { doc, collections, undo, mockupId, server } = withChatMockup()
    const sv = Y.encodeStateVector(server)
    createRoomCollections(server).mockupLayers.delete(mockupId)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, sv), "provider")

    expect(collections.mockupLayers.has(mockupId)).toBe(false)
    expect(undo.deletedMockupFiles()).toEqual([])
  })

  it("undoes a rename", () => {
    const { ops, collections, undo, mockupId } = withChatMockup()
    ops.patch("mockupLayers", mockupId, { title: "Renamed" })

    undo.undo()
    expect(collections.mockupLayers.get(mockupId)?.title).toBe("Option A")
  })
})

describe("a delete", () => {
  it("is its own undo step, apart from the edit just before it", () => {
    const { ops, collections, undo } = canvas()
    ops.patch("iframeLayerGroups", "group-1", { x: 200 })
    // Straight after the move: it must not join the move's step.
    ops.removeLayers(["frame-1", "frame-2"])

    undo.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(true)
    expect(collections.iframeLayers.has("frame-2")).toBe(true)
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(200)
  })

  it("doesn't take in the edit just after it", () => {
    const { ops, collections, undo } = canvas()
    ops.removeLayers(["frame-1"])
    ops.patch("iframeLayerGroups", "group-1", { x: 200 })

    undo.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(false)
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(0)
    undo.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(true)
  })

  it("covers a canvas memory entry", () => {
    const { collections, undo } = canvas()
    const entry = addMemory(collections, { text: "Use pnpm", source: "member" })
    removeMemory(collections, entry!.id)

    undo.undo()
    expect(collections.memories.get(entry!.id)?.text).toBe("Use pnpm")
    undo.undo()
    expect(collections.memories.has(entry!.id)).toBe(false)
  })
})

describe("Fit to content", () => {
  it("undoes turning it on, back to the height before", () => {
    const { ops, collections, undo } = canvas()
    ops.patch("iframeLayers", "frame-1", { fitHeight: true, height: 900 })
    // The page reports the height it was just fitted to.
    ops.followContentHeight("frame-1", 900)

    undo.undo()
    expect(collections.iframeLayers.get("frame-1")?.height).toBe(300)
    expect(collections.iframeLayers.get("frame-1")?.fitHeight).toBeUndefined()
  })

  it("never steps through a height the page made", () => {
    const { doc, ops, collections, undo } = canvas()
    // Turned on by someone else, so there's nothing of this member's to undo.
    doc.transact(() => {
      collections.iframeLayers.update("frame-1", { fitHeight: true })
    }, "sync")
    ops.followContentHeight("frame-1", 1200)

    undo.undo()
    expect(collections.iframeLayers.get("frame-1")?.height).toBe(1200)
  })
})

describe("page views (#1838)", () => {
  it("never makes moving the camera a step", () => {
    const { ops, collections, undo } = canvas()
    ops.renamePage("page-1", "Home")
    ops.savePageView("ann", "page-1", { x: 5, y: 5, zoom: 2 })

    undo.undo()

    expect(collections.pages.get("page-1")).toBeUndefined()
    expect(collections.pageViews.get("ann:page-1")).toMatchObject({
      x: 5,
      zoom: 2,
    })
  })

  it("brings everyone's views back with a deleted page", () => {
    const { ops, collections, undo } = canvas()
    const second = ops.createPage()
    ops.savePageView("ann", second, { x: 1, y: 2, zoom: 3 })
    ops.savePageView("bob", second, { x: 4, y: 5, zoom: 6 })
    // A delete is its own step, so one ⌘Z undoes only it.
    ops.batch(() => {
      collections.pages.delete(second)
      ops.removePageViews(second)
    })
    expect(collections.pageViews.toArray()).toEqual([])

    undo.undo()

    expect(collections.pages.has(second)).toBe(true)
    expect(collections.pageViews.get(`ann:${second}`)).toMatchObject({ x: 1 })
    expect(collections.pageViews.get(`bob:${second}`)).toMatchObject({ x: 4 })
  })
})
