import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { addMemory, removeMemory } from "@/lib/canvas/memory"
import {
  createCanvasUndo,
  deletedMessage,
  type DeletedCounts,
  type DeleteStep,
} from "@/lib/canvas/undo"
import { COLLECTION_KEYS } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseLayer,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

/** A canvas with one Group holding two frames and a document with a chat. */
function canvas() {
  const h = makeHarness()
  const { collections } = h
  collections.branches.set("ws-1", baseBranch("ws-1"))
  collections.iframeLayers.set("frame-1", baseLayer("frame-1"))
  collections.iframeLayers.set("frame-2", baseLayer("frame-2"))
  collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
  collections.chatSessions.set(
    "chat-1",
    baseChat("chat-1", { markdownLayerId: "doc-1" })
  )
  seedGroup(collections, "group-1", [
    { kind: "iframe-layer", id: "frame-1" },
    { kind: "iframe-layer", id: "frame-2" },
    { kind: "markdown-layer", id: "doc-1" },
  ])
  const steps: DeleteStep[] = []
  // Created after seeding, as the canvas mounts after the room loads.
  const undo = createCanvasUndo(h.doc, { onDelete: (s) => steps.push(s) })
  return { ...h, undo, steps }
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

  it("brings a deleted document back with its chat", () => {
    const { ops, collections, undo } = canvas()
    ops.removeDocuments(["doc-1"])
    expect(collections.chatSessions.has("chat-1")).toBe(false)

    undo.undo()
    expect(collections.markdownLayers.has("doc-1")).toBe(true)
    expect(collections.chatSessions.get("chat-1")?.markdownLayerId).toBe(
      "doc-1"
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

describe("a delete step", () => {
  it("reports what went and undoes exactly that", () => {
    const { ops, collections, steps } = canvas()
    ops.patch("iframeLayerGroups", "group-1", { x: 200 })
    // Straight after the move: it must not join the move's step.
    ops.removeLayers(["frame-1", "frame-2"])

    expect(steps).toHaveLength(1)
    expect(deletedMessage(steps[0]!.counts)).toBe("2 frames deleted")

    steps[0]!.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(true)
    expect(collections.iframeLayers.has("frame-2")).toBe(true)
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(200)
  })

  it("settles when ⌘Z undoes it", () => {
    const { ops, undo, steps } = canvas()
    ops.removeLayers(["frame-1"])
    const settled = vi.fn()
    steps[0]!.onSettled(settled)

    undo.undo()
    expect(settled).toHaveBeenCalledOnce()
  })

  it("stops undoing once a newer edit is on the stack", () => {
    const { ops, collections, steps } = canvas()
    ops.removeLayers(["frame-1"])
    const settled = vi.fn()
    steps[0]!.onSettled(settled)
    ops.patch("iframeLayerGroups", "group-1", { x: 200 })
    expect(settled).toHaveBeenCalledOnce()

    steps[0]!.undo()
    expect(collections.iframeLayers.has("frame-1")).toBe(false)
    expect(collections.iframeLayerGroups.get("group-1")?.x).toBe(200)
  })

  it("isn't reported for a redo or for undoing a creation", () => {
    const { ops, undo, steps } = canvas()
    ops.removeLayers(["frame-1"])
    undo.undo()
    undo.redo()
    ops.createDocument({ x: 0, y: 0 }, { width: 300, height: 200 })
    undo.undo()
    expect(steps).toHaveLength(1)
  })

  it("covers a canvas memory entry", () => {
    const { collections, steps, undo } = canvas()
    const entry = addMemory(collections, { text: "Use pnpm", source: "member" })
    removeMemory(collections, entry!.id)

    expect(deletedMessage(steps[0]!.counts)).toBe("Memory deleted")
    steps[0]!.undo()
    expect(collections.memories.get(entry!.id)?.text).toBe("Use pnpm")
    undo.undo()
    expect(collections.memories.has(entry!.id)).toBe(false)
  })
})

describe("deletedMessage", () => {
  const counts = (c: Partial<DeletedCounts>): DeletedCounts => ({
    iframeLayers: 0,
    iframeLayerGroups: 0,
    markdownLayers: 0,
    mockupLayers: 0,
    memories: 0,
    ...c,
  })

  it("names what went", () => {
    expect(deletedMessage(counts({ iframeLayers: 1 }))).toBe("Frame deleted")
    expect(deletedMessage(counts({ markdownLayers: 2 }))).toBe(
      "2 documents deleted"
    )
    expect(
      deletedMessage(
        counts({ iframeLayers: 2, markdownLayers: 1, iframeLayerGroups: 1 })
      )
    ).toBe("3 items deleted")
    expect(deletedMessage(counts({ mockupLayers: 1 }))).toBe("Mockup deleted")
    expect(deletedMessage(counts({ markdownLayers: 1, mockupLayers: 2 }))).toBe(
      "3 items deleted"
    )
    expect(deletedMessage(counts({ iframeLayerGroups: 1 }))).toBe(
      "Group deleted"
    )
  })
})
