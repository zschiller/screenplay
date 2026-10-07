import { describe, expect, it } from "vitest"
import { UndoManager } from "yjs"
import { groupBranchId } from "@/lib/canvas/group-workspace"
import { hideDoneWorkspaceFrames } from "@/lib/canvas/done-workspaces"
import { getGroupMembers } from "@/lib/canvas/layout"
import { CANVAS_OPS_ORIGIN, CONTENT_HEIGHT_ORIGIN } from "@/lib/canvas/ops"
import { pageAfterDelete } from "@/lib/canvas/pages"
import { createCanvasUndo } from "@/lib/canvas/undo"
import {
  FIT_CONTENT_MAX_HEIGHT,
  MIN_IFRAME_LAYER_HEIGHT,
  MIN_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { routeToLabel } from "@/lib/route-utils"
import {
  documentFragment,
  getFragmentTitle,
  setFragmentTitle,
} from "@/lib/yjs/fragment-text"
import { mockupHtml } from "@/lib/yjs/mockup-html"
import { COLLECTION_KEYS } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseLayer,
  baseRepo,
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

describe("removeLayers", () => {
  it("drops removed Iframe Layers from their Group but keeps surviving Members", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    collections.iframeLayers.set("layer-2", baseLayer("layer-2"))
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    ops.removeLayers(["layer-1"])

    expect(collections.iframeLayers.has("layer-1")).toBe(false)
    expect(collections.iframeLayers.has("layer-2")).toBe(true)
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
    ])
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("prunes a Group once its last Iframe Layer Member is removed", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    ops.removeLayers(["layer-1"])

    expect(collections.iframeLayerGroups.has("group-1")).toBe(false)
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("reports no removed Chat Ids — Iframe Layers own no Chat Sessions", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    expect(ops.removeLayers(["layer-1"])).toEqual({ removedChatIds: [] })
  })
})

describe("removeDocuments", () => {
  it("prunes a Group once its last Document Member is removed", () => {
    const { ops, collections } = makeHarness()
    collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
    seedGroup(collections, "group-1", [{ kind: "markdown-layer", id: "doc-1" }])

    ops.removeDocuments(["doc-1"])

    expect(collections.markdownLayers.has("doc-1")).toBe(false)
    expect(collections.iframeLayerGroups.has("group-1")).toBe(false)
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("leaves the chat that wrote a removed Document (#1314)", () => {
    const { ops, collections } = makeHarness()
    collections.markdownLayers.set(
      "doc-1",
      baseDoc("doc-1", { lastChangedByChatId: "chat-1" })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "agent-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "markdown-layer", id: "doc-1" }])

    expect(ops.removeDocuments(["doc-1"])).toEqual({ removedChatIds: [] })
    expect(collections.markdownLayers.has("doc-1")).toBe(false)
    expect(collections.chatSessions.has("chat-1")).toBe(true)
  })

  it("leaves a mixed Group standing when only its Document Member is removed", () => {
    const { ops, collections } = makeHarness()
    collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [
      { kind: "markdown-layer", id: "doc-1" },
      { kind: "iframe-layer", id: "layer-1" },
    ])

    ops.removeDocuments(["doc-1"])

    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
    ])
  })
})

describe("createMockup", () => {
  it("starts a fresh Group at the anchor for a standalone mockup, with no page yet", () => {
    const { doc, ops, collections } = makeHarness()

    const result = ops.createMockup({
      title: "Receipt",
      width: 720,
      height: 800,
      anchor: { x: 40, y: 60 },
    })

    expect(result).toBeDefined()
    const { mockupId, groupId } = result!
    expect(collections.mockupLayers.get(mockupId)).toEqual({
      id: mockupId,
      fileId: mockupId,
      width: 720,
      height: 800,
      title: "Receipt",
    })
    expect(collections.iframeLayerGroups.get(groupId)).toMatchObject({
      x: 40,
      y: 60,
      members: [{ kind: "mockup-layer", id: mockupId }],
    })
    // Its page is a folder the server writes (#1886): nothing in the doc.
    expect(mockupHtml(doc, mockupId).toString()).toBe("")
  })

  it("joins the end of a Group beside its frame, remembering its chat", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    const result = ops.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-1",
      groupId: "group-1",
    })

    expect(result?.groupId).toBe("group-1")
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "mockup-layer", id: result!.mockupId },
    ])
    expect(
      collections.mockupLayers.get(result!.mockupId)?.lastChangedByChatId
    ).toBe("chat-1")
  })

  it("writes nothing when the named Group is missing", () => {
    const { ops, collections } = makeHarness()

    const result = ops.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
      groupId: "missing",
    })

    expect(result).toBeUndefined()
    expect(collections.mockupLayers.toArray()).toEqual([])
  })
})

describe("updateMockup", () => {
  it("renames the file", () => {
    const { ops, collections } = makeHarness()
    const { mockupId } = ops.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-1",
    })!

    expect(ops.updateMockup(mockupId, { title: "Option B" })).toBe(true)

    expect(collections.mockupLayers.get(mockupId)).toMatchObject({
      title: "Option B",
      lastChangedByChatId: "chat-1",
    })
  })

  it("reports a missing mockup", () => {
    const { ops } = makeHarness()

    expect(ops.updateMockup("gone", { title: "B" })).toBe(false)
  })
})

describe("duplicateIframeLayer", () => {
  it("copies size, Fit to content, label, Workspace and route to the end of its Group", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", {
        label: "Checkout",
        width: 390,
        height: 844,
        branchId: "branch-1",
        route: "/cart",
        fitHeight: true,
      })
    )
    collections.iframeLayers.set("layer-2", baseLayer("layer-2"))
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    const copyId = ops.duplicateIframeLayer("layer-1")

    expect(copyId).toBeDefined()
    expect(collections.iframeLayers.get(copyId!)).toMatchObject({
      label: "Checkout copy",
      width: 390,
      height: 844,
      branchId: "branch-1",
      route: "/cart",
      fitHeight: true,
    })
    expect(
      collections.iframeLayerGroups.get("group-1")?.members?.map((m) => m.id)
    ).toEqual(["layer-1", "layer-2", copyId])
  })

  it("writes nothing for a missing frame", () => {
    const { ops, collections } = makeHarness()

    expect(ops.duplicateIframeLayer("gone")).toBeUndefined()
    expect(collections.iframeLayers.toArray()).toEqual([])
  })
})

describe("followContentHeight", () => {
  it("sets a fitting frame's height to its content, outside Undo's origin", () => {
    const { doc, ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { fitHeight: true })
    )
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    expect(ops.followContentHeight("layer-1", 1234.2)).toBe(true)

    expect(collections.iframeLayers.get("layer-1")).toMatchObject({
      width: 400,
      height: 1235,
    })
    expect(origins).toEqual([CONTENT_HEIGHT_ORIGIN])
  })

  it("follows a Mockup's page too", () => {
    const { ops, collections } = makeHarness()
    const { mockupId } = ops.createMockup({
      title: "Hi",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 0 },
    })!
    ops.patch("mockupLayers", mockupId, { fitHeight: true })

    ops.followContentHeight(mockupId, 900)

    expect(collections.mockupLayers.get(mockupId)?.height).toBe(900)
  })

  it("leaves a frame whose Fit to content is off", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))

    expect(ops.followContentHeight("layer-1", 900)).toBe(false)
    expect(collections.iframeLayers.get("layer-1")?.height).toBe(300)
  })

  it("keeps between the minimum and a ceiling", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { fitHeight: true })
    )

    ops.followContentHeight("layer-1", 10)
    expect(collections.iframeLayers.get("layer-1")?.height).toBe(
      MIN_IFRAME_LAYER_HEIGHT
    )
    ops.followContentHeight("layer-1", 1e9)
    expect(collections.iframeLayers.get("layer-1")?.height).toBe(
      FIT_CONTENT_MAX_HEIGHT
    )
  })
})

describe("duplicateMockup", () => {
  it("copies the page, size, knobs and chat to the end of its Group", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])
    const { mockupId } = ops.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-1",
      groupId: "group-1",
    })!
    collections.mockupLayers.update(mockupId, {
      knobs: [{ id: "tone" }],
      knobValues: { tone: "warm" },
    })
    seedGroup(collections, "group-1", [
      { kind: "mockup-layer", id: mockupId },
      { kind: "iframe-layer", id: "layer-1" },
    ])

    const copyId = ops.duplicateMockup(mockupId)

    expect(copyId).toBeDefined()
    expect(collections.mockupLayers.get(copyId!)).toEqual({
      id: copyId,
      fileId: copyId,
      width: 400,
      height: 300,
      title: "Option A copy",
      lastChangedByChatId: "chat-1",
      knobs: [{ id: "tone" }],
      knobValues: { tone: "warm" },
      // A member's canvas can't write the file store: the server copies
      // the folder on the copy's first read (#1886).
      copyOf: mockupId,
    })
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "mockup-layer", id: mockupId },
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "mockup-layer", id: copyId },
    ])
  })

  it("writes nothing for a missing mockup", () => {
    const { ops, collections } = makeHarness()

    expect(ops.duplicateMockup("gone")).toBeUndefined()
    expect(collections.mockupLayers.toArray()).toEqual([])
  })
})

describe("removeMockups", () => {
  it("drops the mockup and prunes the Group it emptied", () => {
    const { ops, collections } = makeHarness()
    const { mockupId, groupId } = ops.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
    })!

    ops.removeMockups([mockupId])

    expect(collections.mockupLayers.has(mockupId)).toBe(false)
    expect(collections.iframeLayerGroups.has(groupId)).toBe(false)
    expect(findEmptyGroups(collections)).toEqual([])
  })
})

describe("removeBranch", () => {
  it("keeps a mockup its removed chat made on the canvas", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.chatSessions.set("chat-1", {
      id: "chat-1",
      branchId: "agent-1",
      label: "Empty cart",
      createdAt: 0,
    })
    const { mockupId, groupId } = ops.createMockup({
      title: "Option A",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-1",
    })!

    ops.removeBranch("agent-1")

    expect(collections.chatSessions.has("chat-1")).toBe(false)
    expect(collections.mockupLayers.has(mockupId)).toBe(true)
    expect(collections.iframeLayerGroups.has(groupId)).toBe(true)
  })

  it("cascades: deletes the agent, its Iframe Layers and Chat Sessions, leaving no orphans or empty Groups", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    collections.iframeLayers.set(
      "layer-2",
      baseLayer("layer-2", { branchId: "agent-1" })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "agent-1" })
    )
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    const { removedChatIds } = ops.removeBranch("agent-1")

    expect(collections.branches.has("agent-1")).toBe(false)
    expect(collections.iframeLayers.has("layer-1")).toBe(false)
    expect(collections.iframeLayers.has("layer-2")).toBe(false)
    expect(removedChatIds).toEqual(["chat-1"])
    expect(collections.chatSessions.has("chat-1")).toBe(false)
    // No orphan Iframe Layers, no committed empty Group.
    expect(collections.iframeLayerGroups.has("group-1")).toBe(false)
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("preserves a sibling Iframe Layer that belongs to a different agent", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    collections.iframeLayers.set(
      "layer-2",
      baseLayer("layer-2", { branchId: "agent-2" })
    )
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    ops.removeBranch("agent-1")

    expect(collections.iframeLayers.has("layer-2")).toBe(true)
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
    ])
  })
})

describe("removeRepo", () => {
  it("cascades across every agent in the repo, leaving no orphans or empty Groups", () => {
    const { ops, collections } = makeHarness()
    collections.repos.set("ws-1", baseRepo("ws-1"))
    collections.branches.set(
      "agent-1",
      baseBranch("agent-1", { repoId: "ws-1" })
    )
    collections.branches.set(
      "agent-2",
      baseBranch("agent-2", { repoId: "ws-1" })
    )
    collections.branches.set(
      "agent-keep",
      baseBranch("agent-keep", { repoId: "ws-other" })
    )
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    collections.iframeLayers.set(
      "layer-2",
      baseLayer("layer-2", { branchId: "agent-2" })
    )
    collections.iframeLayers.set(
      "layer-keep",
      baseLayer("layer-keep", { branchId: "agent-keep" })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "agent-1" })
    )
    collections.chatSessions.set(
      "chat-2",
      baseChat("chat-2", { branchId: "agent-2" })
    )
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])
    seedGroup(collections, "group-keep", [
      { kind: "iframe-layer", id: "layer-keep" },
    ])

    const { removedChatIds } = ops.removeRepo("ws-1")

    expect(collections.repos.has("ws-1")).toBe(false)
    expect(collections.branches.has("agent-1")).toBe(false)
    expect(collections.branches.has("agent-2")).toBe(false)
    expect(collections.iframeLayers.has("layer-1")).toBe(false)
    expect(collections.iframeLayers.has("layer-2")).toBe(false)
    expect(removedChatIds.sort()).toEqual(["chat-1", "chat-2"])
    expect(collections.iframeLayerGroups.has("group-1")).toBe(false)
    // Another repo's agent, layer, and Group are untouched.
    expect(collections.branches.has("agent-keep")).toBe(true)
    expect(collections.iframeLayers.has("layer-keep")).toBe(true)
    expect(collections.iframeLayerGroups.has("group-keep")).toBe(true)
    expect(findEmptyGroups(collections)).toEqual([])
  })
})

describe("moveLayerToGroup", () => {
  it("moves a Member to the target Group and prunes the emptied source", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "source", [{ kind: "iframe-layer", id: "layer-1" }])
    seedGroup(collections, "target", [{ kind: "iframe-layer", id: "layer-2" }])

    ops.moveLayerToGroup("layer-1", "target")

    expect(collections.iframeLayerGroups.has("source")).toBe(false)
    expect(collections.iframeLayerGroups.get("target")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
      { kind: "iframe-layer", id: "layer-1" },
    ])
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("keeps the source standing and writes back its survivors when it still holds Members", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "source", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])
    seedGroup(collections, "target", [{ kind: "iframe-layer", id: "layer-3" }])

    ops.moveLayerToGroup("layer-1", "target", 0)

    expect(collections.iframeLayerGroups.get("source")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
    ])
    // `index` controls placement within the target row.
    expect(collections.iframeLayerGroups.get("target")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-3" },
    ])
  })

  it("preserves the Member's kind when moving a Document", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "source", [{ kind: "markdown-layer", id: "doc-1" }])
    seedGroup(collections, "target", [{ kind: "iframe-layer", id: "layer-1" }])

    ops.moveLayerToGroup("doc-1", "target")

    expect(collections.iframeLayerGroups.get("target")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "markdown-layer", id: "doc-1" },
    ])
  })

  it("reorders within a single Group when source and target are the same", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
      { kind: "iframe-layer", id: "layer-3" },
    ])

    ops.moveLayerToGroup("layer-1", "group-1", 2)

    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
      { kind: "iframe-layer", id: "layer-3" },
      { kind: "iframe-layer", id: "layer-1" },
    ])
  })
})

describe("mergeGroups", () => {
  it("appends the source's Members onto the target and prunes the emptied source", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "target", [{ kind: "iframe-layer", id: "layer-1" }])
    seedGroup(collections, "source", [
      { kind: "iframe-layer", id: "layer-2" },
      { kind: "markdown-layer", id: "doc-1" },
    ])

    ops.mergeGroups("source", "target")

    expect(collections.iframeLayerGroups.has("source")).toBe(false)
    expect(collections.iframeLayerGroups.get("target")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
      { kind: "markdown-layer", id: "doc-1" },
    ])
    expect(findEmptyGroups(collections)).toEqual([])
  })
})

describe("splitToNewGroup", () => {
  it("pulls a Member into a fresh Group at the anchor, pruning the emptied source", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "source", [{ kind: "iframe-layer", id: "layer-1" }])

    const groupId = ops.splitToNewGroup(["layer-1"], { x: 120, y: 240 })

    expect(collections.iframeLayerGroups.has("source")).toBe(false)
    const created = collections.iframeLayerGroups.get(groupId)
    expect(created?.members).toEqual([{ kind: "iframe-layer", id: "layer-1" }])
    expect(created?.x).toBe(120)
    expect(created?.y).toBe(240)
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("leaves the source standing with its survivors when not fully drained", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "source", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    const groupId = ops.splitToNewGroup(["layer-1"], { x: 0, y: 0 })

    expect(collections.iframeLayerGroups.get("source")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
    ])
    expect(collections.iframeLayerGroups.get(groupId)?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
    ])
  })

  it("names the new Group with the next available number", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayerGroups.set("g", {
      id: "g",
      name: "Group 3",
      x: 0,
      y: 0,
      members: [
        { kind: "iframe-layer", id: "layer-1" },
        { kind: "iframe-layer", id: "layer-2" },
      ],
    })

    const groupId = ops.splitToNewGroup(["layer-1"], { x: 0, y: 0 })

    expect(collections.iframeLayerGroups.get(groupId)?.name).toBe("Group 4")
  })
})

describe("createBlankFrame", () => {
  it("places a fresh Iframe Layer in its own Group at the anchor", () => {
    const { ops, collections } = makeHarness()

    const layerId = ops.createBlankFrame(
      { x: 120, y: 80 },
      { width: 500, height: 400 }
    )

    const layer = collections.iframeLayers.get(layerId)
    expect(layer?.width).toBe(500)
    expect(layer?.height).toBe(400)
    // A blank frame is bound to no agent.
    expect(layer?.branchId).toBeUndefined()

    const group = collections.iframeLayerGroups.toArray()[0]
    expect(group?.x).toBe(120)
    expect(group?.y).toBe(80)
    expect(group?.members).toEqual([{ kind: "iframe-layer", id: layerId }])
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("clamps a below-minimum size up to the floor", () => {
    const { ops, collections } = makeHarness()

    const layerId = ops.createBlankFrame(
      { x: 0, y: 0 },
      { width: 10, height: 10 }
    )

    const layer = collections.iframeLayers.get(layerId)
    expect(layer?.width).toBe(MIN_IFRAME_LAYER_WIDTH)
    expect(layer?.height).toBe(MIN_IFRAME_LAYER_HEIGHT)
  })
})

describe("createFrameForAgent", () => {
  it("creates an agent-bound Iframe Layer in a fresh Group, sized from the repo preset", () => {
    const { ops, collections } = makeHarness()
    collections.repos.set(
      "ws-1",
      baseRepo("ws-1", { defaultIframeLayerSizeId: "iphone-se" })
    )
    collections.branches.set(
      "agent-1",
      baseBranch("agent-1", { repoId: "ws-1" })
    )

    const { layerId, groupId } = ops.createFrameForAgent(
      "agent-1",
      { x: 0, y: 0 },
      "Home"
    )

    const layer = collections.iframeLayers.get(layerId)
    expect(layer?.branchId).toBe("agent-1")
    expect(layer?.label).toBe("Home")
    // iphone-se preset is 375 × 667.
    expect(layer?.width).toBe(375)
    expect(layer?.height).toBe(667)
    expect(collections.iframeLayerGroups.get(groupId)?.members).toEqual([
      { kind: "iframe-layer", id: layerId },
    ])
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("places the new Group to the right of an existing Group, reading the live snapshot", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    // An existing group spanning [0, 400] on x; the new frame must clear it.
    collections.iframeLayers.set(
      "layer-0",
      baseLayer("layer-0", { width: 400 })
    )
    seedGroup(collections, "existing", [
      { kind: "iframe-layer", id: "layer-0" },
    ])

    const { groupId } = ops.createFrameForAgent("agent-1", { x: 0, y: 0 })

    // placeNewIframeLayerGroup anchors at maxRight (0 + 400) + gap (50).
    expect(collections.iframeLayerGroups.get(groupId)?.x).toBe(450)
  })
})

describe("createFramesForRoutes", () => {
  it("creates one agent-bound Iframe Layer per route in a single Group, returning the first", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))

    const result = ops.createFramesForRoutes(
      "agent-1",
      [
        { route: "/", label: "Home" },
        { route: "/about", label: "" },
      ],
      { x: 0, y: 0 }
    )

    expect(result).toBeDefined()
    const { groupId, firstLayerId } = result!
    const group = collections.iframeLayerGroups.get(groupId)
    expect(group?.members).toHaveLength(2)
    expect(group?.members[0]).toEqual({
      kind: "iframe-layer",
      id: firstLayerId,
    })

    const first = collections.iframeLayers.get(firstLayerId)
    expect(first?.branchId).toBe("agent-1")
    expect(first?.route).toBe("/")
    expect(first?.label).toBe("Home")
    // A blank label falls back to a label derived from the route.
    const secondId = group!.members[1]!.id
    expect(collections.iframeLayers.get(secondId)?.label).toBe(
      routeToLabel("/about")
    )
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("is a no-op for an empty route list", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))

    expect(
      ops.createFramesForRoutes("agent-1", [], { x: 0, y: 0 })
    ).toBeUndefined()
    expect(collections.iframeLayers.toArray()).toEqual([])
    expect(collections.iframeLayerGroups.toArray()).toEqual([])
  })
})

describe("createFramesForAgents", () => {
  it("seeds one frame per Branch in a single Group, clearing each Branch's seed flag", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set(
      "agent-1",
      baseBranch("agent-1", { pendingIframeLayerSeed: true })
    )
    collections.branches.set(
      "agent-2",
      baseBranch("agent-2", { pendingIframeLayerSeed: true })
    )

    const result = ops.createFramesForAgents(
      [
        { agentId: "agent-1", label: "Alpha" },
        { agentId: "agent-2", label: "Beta" },
      ],
      { x: 0, y: 0 }
    )

    expect(result).toBeDefined()
    const { groupId, layerIds } = result!
    expect(layerIds).toHaveLength(2)

    const group = collections.iframeLayerGroups.get(groupId)
    expect(group?.members).toEqual([
      { kind: "iframe-layer", id: layerIds[0] },
      { kind: "iframe-layer", id: layerIds[1] },
    ])

    expect(collections.iframeLayers.get(layerIds[0]!)?.branchId).toBe("agent-1")
    expect(collections.iframeLayers.get(layerIds[0]!)?.label).toBe("Alpha")
    expect(collections.iframeLayers.get(layerIds[1]!)?.branchId).toBe("agent-2")
    expect(collections.iframeLayers.get(layerIds[1]!)?.label).toBe("Beta")

    // The eager seed fulfils the deferred-seed contract for both Branches.
    expect(collections.branches.get("agent-1")?.pendingIframeLayerSeed).toBe(
      false
    )
    expect(collections.branches.get("agent-2")?.pendingIframeLayerSeed).toBe(
      false
    )
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("creates a single-member Group for one Branch, defaulting the label", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))

    const result = ops.createFramesForAgents([{ agentId: "agent-1" }], {
      x: 0,
      y: 0,
    })

    const { groupId, layerIds } = result!
    expect(layerIds).toHaveLength(1)
    expect(collections.iframeLayers.get(layerIds[0]!)?.label).toBe("Frame 1")
    expect(collections.iframeLayerGroups.get(groupId)?.members).toEqual([
      { kind: "iframe-layer", id: layerIds[0] },
    ])
  })

  it("is a no-op for an empty Branch list", () => {
    const { ops, collections } = makeHarness()

    expect(ops.createFramesForAgents([], { x: 0, y: 0 })).toBeUndefined()
    expect(collections.iframeLayers.toArray()).toEqual([])
    expect(collections.iframeLayerGroups.toArray()).toEqual([])
  })
})

describe("createDocument", () => {
  it("seeds the body fragment at the right key and returns a coherent { docId, groupId }", () => {
    const { ops, collections, doc } = makeHarness()

    const { docId, groupId } = ops.createDocument(
      { x: 40, y: 60 },
      { width: 320, height: 240 }
    )

    // The Document record lands in a fresh Group anchored at the drop point.
    const document = collections.markdownLayers.get(docId)
    expect(document?.width).toBe(320)
    expect(document?.height).toBe(240)
    const group = collections.iframeLayerGroups.get(groupId)
    expect(group?.x).toBe(40)
    expect(group?.y).toBe(60)
    expect(group?.members).toEqual([{ kind: "markdown-layer", id: docId }])

    // The body fragment is seeded with the schema-required title heading, at
    // the key the single fragment-key owner resolves for this id.
    const fragment = documentFragment(doc, docId)
    expect(fragment.length).toBe(1)
    expect(getFragmentTitle(fragment)).toBe("")

    // No chat comes with it (#1314): a hand-made Document has no owner.
    expect(collections.chatSessions.toArray()).toEqual([])
    expect(document?.lastChangedByChatId).toBeUndefined()
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("records the chat that made a Document (#1314)", () => {
    const { ops, collections } = makeHarness()

    const { docId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 320, height: 240 },
      { lastChangedByChatId: "chat-1" }
    )

    expect(collections.markdownLayers.get(docId)?.lastChangedByChatId).toBe(
      "chat-1"
    )
  })

  it("clamps a below-minimum size up to the document floor", () => {
    const { ops, collections } = makeHarness()

    const { docId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 10, height: 10 }
    )

    const document = collections.markdownLayers.get(docId)
    expect(document?.width).toBe(200)
    expect(document?.height).toBe(120)
  })
})

describe("page views (#1838)", () => {
  it("saves one member's view of one page, stamped as seen now", () => {
    const { ops, collections, doc } = makeHarness()
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.savePageView("ann", "p2", { x: 12, y: 34, zoom: 1.5 })

    expect(collections.pageViews.get("ann:p2")).toMatchObject({
      userId: "ann",
      pageId: "p2",
      x: 12,
      y: 34,
      zoom: 1.5,
    })
    expect(collections.pageViews.get("ann:p2")?.seenAt).toBeTypeOf("number")
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })

  it("keeps two members' views of one page apart", () => {
    const { ops, collections } = makeHarness()
    ops.savePageView("ann", "p1", { x: 1, y: 1, zoom: 1 })
    ops.savePageView("bob", "p1", { x: 2, y: 2, zoom: 2 })
    ops.savePageView("ann", "p1", { x: 3, y: 3, zoom: 0.5 })

    expect(collections.pageViews.get("ann:p1")).toMatchObject({
      x: 3,
      zoom: 0.5,
    })
    expect(collections.pageViews.get("bob:p1")).toMatchObject({ x: 2, zoom: 2 })
  })

  it("removes every view of a page, and every view of a member", () => {
    const { ops, collections } = makeHarness()
    ops.savePageView("ann", "p1", { x: 0, y: 0, zoom: 1 })
    ops.savePageView("ann", "p2", { x: 0, y: 0, zoom: 1 })
    ops.savePageView("bob", "p2", { x: 0, y: 0, zoom: 1 })
    ops.savePageView("bob", "p3", { x: 0, y: 0, zoom: 1 })

    ops.removePageViews("p2")
    expect(
      collections.pageViews
        .toArray()
        .map((v) => `${v.userId}:${v.pageId}`)
        .sort()
    ).toEqual(["ann:p1", "bob:p3"])

    ops.removeMemberViews("bob")
    expect(
      collections.pageViews.toArray().map((v) => `${v.userId}:${v.pageId}`)
    ).toEqual(["ann:p1"])
  })
})

describe("createRepo", () => {
  it("writes the repo record under the canvas-ops origin", () => {
    const { ops, collections, doc } = makeHarness()
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.createRepo("ws-1", baseRepo("ws-1", { name: "My app" }))

    expect(collections.repos.get("ws-1")?.name).toBe("My app")
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })
})

describe("addChatSession", () => {
  it("writes the chat-session identity record under the canvas-ops origin", () => {
    const { ops, collections, doc } = makeHarness()
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.addChatSession("chat-1", baseChat("chat-1", { branchId: "agent-1" }))

    expect(collections.chatSessions.get("chat-1")?.branchId).toBe("agent-1")
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })
})

describe("removeChatSession", () => {
  it("deletes a single chat-session record under the canvas-ops origin", () => {
    const { ops, collections, doc } = makeHarness()
    collections.chatSessions.set("chat-1", baseChat("chat-1"))
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.removeChatSession("chat-1")

    expect(collections.chatSessions.has("chat-1")).toBe(false)
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })
})

describe("navigateRoute", () => {
  it("updates the frame's route and registers it on the agent's discoveredRoutes", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1", route: "/" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    const { viewportShift } = ops.navigateRoute("layer-1", "/about", {
      cloneTrail: false,
    })

    expect(collections.iframeLayers.get("layer-1")?.route).toBe("/about")
    expect(collections.branches.get("agent-1")?.discoveredRoutes).toEqual([
      { route: "/about", label: routeToLabel("/about") },
    ])
    // No clone trail → no member added and no viewport pan.
    expect(collections.iframeLayerGroups.get("group-1")?.members).toHaveLength(
      1
    )
    expect(viewportShift).toBe(0)
  })

  it("does not duplicate a route already on the agent", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set(
      "agent-1",
      baseBranch("agent-1", {
        discoveredRoutes: [{ route: "/about", label: "About" }],
      })
    )
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1", route: "/" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    ops.navigateRoute("layer-1", "/about", { cloneTrail: false })

    expect(collections.branches.get("agent-1")?.discoveredRoutes).toEqual([
      { route: "/about", label: "About" },
    ])
  })

  it("drops a clone of the previous route into the group when trailing, returning the pan width", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1", route: "/", width: 400 })
    )
    collections.iframeLayerGroups.set("group-1", {
      id: "group-1",
      name: "group-1",
      x: 0,
      y: 0,
      members: [{ kind: "iframe-layer", id: "layer-1" }],
      gap: 50,
    })

    const { viewportShift } = ops.navigateRoute("layer-1", "/about", {
      cloneTrail: true,
    })

    const members = collections.iframeLayerGroups.get("group-1")!.members
    expect(members).toHaveLength(2)
    // The clone holds the previous route and is spliced in just before the
    // navigated frame so the trail grows leftward.
    const cloneId = members[0]!.id
    expect(members[1]).toEqual({ kind: "iframe-layer", id: "layer-1" })
    expect(collections.iframeLayers.get(cloneId)?.route).toBe("/")
    expect(collections.iframeLayers.get("layer-1")?.route).toBe("/about")
    // The viewport pans right by the clone's width + the group's gap.
    expect(viewportShift).toBe(450)
  })

  it("leaves no clone when the route is unchanged even in trail mode", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { route: "/same" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    const { viewportShift } = ops.navigateRoute("layer-1", "/same", {
      cloneTrail: true,
    })

    expect(collections.iframeLayerGroups.get("group-1")?.members).toHaveLength(
      1
    )
    expect(viewportShift).toBe(0)
  })
})

describe("addFrameToGroup", () => {
  it("creates the frame and appends it to the existing Group's members", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    const id = ops.addFrameToGroup("group-1", {
      width: 420,
      height: 320,
      label: "Frame 2",
      branchId: "agent-1",
      route: "/about",
    })

    expect(id).toBeDefined()
    const layer = collections.iframeLayers.get(id!)
    expect(layer?.width).toBe(420)
    expect(layer?.branchId).toBe("agent-1")
    expect(layer?.route).toBe("/about")
    // Appended after the existing sibling, preserving row order.
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id },
    ])
  })

  it("omits branchId and route for a blank frame", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    const id = ops.addFrameToGroup("group-1", {
      width: 400,
      height: 300,
      label: "Frame",
    })

    const layer = collections.iframeLayers.get(id!)
    expect(layer?.branchId).toBeUndefined()
    expect(layer?.route).toBeUndefined()
  })

  it("commits under the canvas-ops origin", () => {
    const { ops, collections, doc } = makeHarness()
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.addFrameToGroup("group-1", { width: 400, height: 300, label: "Frame" })

    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })

  it("is a no-op returning undefined when the Group is missing", () => {
    const { ops, collections } = makeHarness()

    const id = ops.addFrameToGroup("missing", {
      width: 400,
      height: 300,
      label: "Frame",
    })

    expect(id).toBeUndefined()
    expect(collections.iframeLayers.toArray()).toEqual([])
  })
})

describe("addDocumentToGroup", () => {
  it("creates the document, seeds its fragment + chat, and appends it to the Group", () => {
    const { ops, collections, doc } = makeHarness()
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])

    const result = ops.addDocumentToGroup("group-1", {
      width: 360,
      height: 280,
    })

    expect(result).toBeDefined()
    const { docId } = result!
    const document = collections.markdownLayers.get(docId)
    expect(document?.width).toBe(360)
    expect(document?.height).toBe(280)
    // Appended after the existing sibling, preserving row order.
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "markdown-layer", id: docId },
    ])
    // Same fragment seeding as createDocument, and no chat.
    const fragment = documentFragment(doc, docId)
    expect(fragment.length).toBe(1)
    expect(getFragmentTitle(fragment)).toBe("")
    expect(collections.chatSessions.toArray()).toEqual([])
  })

  it("clamps a below-minimum size up to the document floor", () => {
    const { ops, collections } = makeHarness()
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "layer-1" }])
    collections.iframeLayers.set("layer-1", baseLayer("layer-1"))

    const result = ops.addDocumentToGroup("group-1", { width: 10, height: 10 })

    const document = collections.markdownLayers.get(result!.docId)
    expect(document?.width).toBe(200)
    expect(document?.height).toBe(120)
  })

  it("is a no-op returning undefined when the Group is missing", () => {
    const { ops, collections } = makeHarness()

    const result = ops.addDocumentToGroup("missing", {
      width: 400,
      height: 300,
    })

    expect(result).toBeUndefined()
    expect(collections.markdownLayers.toArray()).toEqual([])
  })
})

describe("renameDocument", () => {
  it("writes the new title into both the body fragment heading and the record", () => {
    const { ops, collections, doc } = makeHarness()
    const { docId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 300, height: 200 }
    )

    ops.renameDocument(docId, "Launch plan")

    // The fragment heading is the source of truth every peer's editor renders;
    // the record `title` is the cache the sidebar/agent tools read.
    expect(getFragmentTitle(documentFragment(doc, docId))).toBe("Launch plan")
    expect(collections.markdownLayers.get(docId)?.title).toBe("Launch plan")
  })

  it("commits the dual write under the canvas-ops origin", () => {
    const { ops, doc } = makeHarness()
    const { docId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 300, height: 200 }
    )
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.renameDocument(docId, "Renamed")

    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })

  it("is a no-op when the Document does not exist", () => {
    const { ops, collections, doc } = makeHarness()

    ops.renameDocument("missing", "ghost")

    expect(collections.markdownLayers.has("missing")).toBe(false)
    // Never seeds a heading for a Document that was never created.
    expect(getFragmentTitle(documentFragment(doc, "missing"))).toBe("")
  })
})

describe("createBranch", () => {
  const spec = {
    repoId: "ws-1",
    sandboxName: "sp-1",
    gitUrl: "https://example.com/repo.git",
    ref: "main",
    previewDomain: "",
    port: 3000,
    status: "creating" as const,
    createdAt: 0,
  }

  it("writes the Branch with the deferred-seed flag set, and no chat when none is requested", () => {
    const { ops, collections } = makeHarness()

    const { branchId, chatId } = ops.createBranch({ branch: spec })

    const branch = collections.branches.get(branchId)
    expect(branch?.repoId).toBe("ws-1")
    expect(branch?.ref).toBe("main")
    // createBranch owns the deferred-seed flag (parent decision 7).
    expect(branch?.pendingIframeLayerSeed).toBe(true)
    expect(chatId).toBeUndefined()
    expect(collections.chatSessions.toArray()).toEqual([])
  })

  it("pre-creates a Chat Session targeting the Branch when a chat spec is given", () => {
    const { ops, collections } = makeHarness()

    const { branchId, chatId } = ops.createBranch({
      branch: spec,
      chat: { label: "Build login", model: "claude-x" },
    })

    expect(chatId).toBeDefined()
    const chat = collections.chatSessions.get(chatId!)
    expect(chat?.branchId).toBe(branchId)
    expect(chat?.label).toBe("Build login")
    expect(chat?.model).toBe("claude-x")
  })

  it("shows the new Branch in a drawn frame and seeds no other frame", () => {
    const { ops, collections } = makeHarness()
    const frameId = ops.createBlankFrame(
      { x: 40, y: 60 },
      { width: 390, height: 844 }
    )
    const before = collections.iframeLayers.toArray().length

    const { branchId } = ops.createBranch({
      branch: spec,
      chat: { label: "Checkout" },
      frameId,
    })

    const frame = collections.iframeLayers.get(frameId)
    expect(frame?.branchId).toBe(branchId)
    // Where and how big it was drawn stays as is.
    expect(frame).toMatchObject({ width: 390, height: 844 })
    const group = collections.iframeLayerGroups
      .toArray()
      .find((g) => getGroupMembers(g).some((m) => m.id === frameId))
    expect(group).toMatchObject({ x: 40, y: 60, branchId })
    // No deferred seed, and no second Group of frames.
    expect(collections.branches.get(branchId)?.pendingIframeLayerSeed).toBe(
      false
    )
    expect(collections.iframeLayers.toArray()).toHaveLength(before)
    expect(collections.iframeLayerGroups.toArray()).toHaveLength(1)
  })

  it("shows an existing Workspace in a frame drawn for it (#1357)", () => {
    const { ops, collections } = makeHarness()
    const { branchId } = ops.createBranch({ branch: spec })
    const frameId = ops.createBlankFrame(
      { x: 40, y: 60 },
      { width: 390, height: 844 }
    )
    const branchesBefore = collections.branches.toArray().length

    ops.assignBranch(frameId, branchId)

    const frame = collections.iframeLayers.get(frameId)
    expect(frame).toMatchObject({ branchId, width: 390, height: 844 })
    const group = collections.iframeLayerGroups
      .toArray()
      .find((g) => getGroupMembers(g).some((m) => m.id === frameId))
    expect(group).toMatchObject({ x: 40, y: 60, branchId })
    // No new Workspace.
    expect(collections.branches.toArray()).toHaveLength(branchesBefore)
  })

  it("falls back to the deferred seed when the frame is gone", () => {
    const { ops, collections } = makeHarness()

    const { branchId } = ops.createBranch({ branch: spec, frameId: "gone" })

    expect(collections.branches.get(branchId)?.pendingIframeLayerSeed).toBe(
      true
    )
  })

  it("lands a drawn Mockup box as the new chat's empty Mockup, at its rect (#1359)", () => {
    const { ops, collections } = makeHarness()
    const { chatId } = ops.createBranch({
      branch: spec,
      chat: { label: "Checkout" },
    })

    ops.createMockup({
      id: "drawn-1",
      title: "",
      width: 390,
      height: 844,
      lastChangedByChatId: chatId,
      anchor: { x: 40, y: 60 },
    })

    expect(collections.mockupLayers.get("drawn-1")).toMatchObject({
      width: 390,
      height: 844,
      lastChangedByChatId: chatId,
    })
    const group = collections.iframeLayerGroups
      .toArray()
      .find((g) => getGroupMembers(g).some((m) => m.id === "drawn-1"))
    expect(group).toMatchObject({ x: 40, y: 60 })
    expect(collections.mockupLayers.get("drawn-1")?.revision).toBeUndefined()
  })
})

describe("seedFrameForAgent", () => {
  it("creates the frame and clears pendingIframeLayerSeed in one transaction", () => {
    const { ops, collections, doc } = makeHarness()
    collections.branches.set(
      "agent-1",
      baseBranch("agent-1", { pendingIframeLayerSeed: true })
    )
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    const { layerId, groupId } = ops.seedFrameForAgent("agent-1", {
      x: 0,
      y: 0,
    })

    expect(collections.iframeLayers.get(layerId)?.branchId).toBe("agent-1")
    expect(collections.iframeLayerGroups.has(groupId)).toBe(true)
    // The flag clears atomically with the layer write — exactly one committed
    // transaction under the canvas-ops origin, so a later frame delete can't
    // race a re-seed.
    expect(collections.branches.get("agent-1")?.pendingIframeLayerSeed).toBe(
      false
    )
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
    expect(findEmptyGroups(collections)).toEqual([])
  })
})

describe("createFrameForAgent", () => {
  it("binds a fresh frame to the agent in its own Group with a default label", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))

    const { layerId, groupId } = ops.createFrameForAgent("agent-1", {
      x: 0,
      y: 0,
    })

    const layer = collections.iframeLayers.get(layerId)
    expect(layer?.branchId).toBe("agent-1")
    expect(layer?.label).toBe("Frame 1")
    expect(collections.iframeLayerGroups.get(groupId)?.members).toEqual([
      { kind: "iframe-layer", id: layerId },
    ])
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("sizes the frame from the agent's repo size preset", () => {
    const { ops, collections } = makeHarness()
    collections.repos.set(
      "ws-1",
      baseRepo("ws-1", { defaultIframeLayerSizeId: "iphone-se" })
    )
    collections.branches.set(
      "agent-1",
      baseBranch("agent-1", { repoId: "ws-1" })
    )

    const { layerId } = ops.createFrameForAgent("agent-1", { x: 0, y: 0 })

    const layer = collections.iframeLayers.get(layerId)
    expect(layer?.width).toBe(375)
    expect(layer?.height).toBe(667)
  })

  it("places the new Group to the right of an existing one (placement-race guard)", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.iframeLayers.set(
      "existing",
      baseLayer("existing", { width: 400 })
    )
    collections.iframeLayerGroups.set("g0", {
      id: "g0",
      name: "Group 1",
      x: 0,
      y: 0,
      members: [{ kind: "iframe-layer", id: "existing" }],
    })

    const { groupId } = ops.createFrameForAgent("agent-1", { x: 0, y: 0 })

    // Read inside the verb's own transaction, so the new Group lands beside the
    // existing one rather than overlapping it.
    expect(collections.iframeLayerGroups.get(groupId)!.x).toBeGreaterThan(400)
  })

  it("honors an explicit label", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))

    const { layerId } = ops.createFrameForAgent(
      "agent-1",
      { x: 0, y: 0 },
      "Home"
    )

    expect(collections.iframeLayers.get(layerId)?.label).toBe("Home")
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
    seedGroup(collections, "group-ok", [
      { kind: "iframe-layer", id: "layer-1" },
    ])

    expect(findEmptyGroups(collections)).toEqual(["group-empty"])
  })
})

describe("reorderRepos", () => {
  it("renumbers each repo's sidebarOrder to its index in the given order", () => {
    const { ops, collections } = makeHarness()
    collections.repos.set("ws-a", baseRepo("ws-a"))
    collections.repos.set("ws-b", baseRepo("ws-b"))
    collections.repos.set("ws-c", baseRepo("ws-c"))

    ops.reorderRepos(["ws-c", "ws-a", "ws-b"])

    expect(collections.repos.get("ws-c")?.sidebarOrder).toBe(0)
    expect(collections.repos.get("ws-a")?.sidebarOrder).toBe(1)
    expect(collections.repos.get("ws-b")?.sidebarOrder).toBe(2)
  })

  it("commits the renumber as one transaction under the canvas-ops origin", () => {
    const { doc, ops, collections } = makeHarness()
    collections.repos.set("ws-a", baseRepo("ws-a"))
    collections.repos.set("ws-b", baseRepo("ws-b"))
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.reorderRepos(["ws-b", "ws-a"])

    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })
})

describe("reorderBranches", () => {
  it("renumbers each agent's sidebarOrder to its index in the given order", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("ag-a", baseBranch("ag-a", { repoId: "ws-1" }))
    collections.branches.set("ag-b", baseBranch("ag-b", { repoId: "ws-1" }))
    collections.branches.set("ag-c", baseBranch("ag-c", { repoId: "ws-1" }))

    ops.reorderBranches("ws-1", ["ag-c", "ag-a", "ag-b"])

    expect(collections.branches.get("ag-c")?.sidebarOrder).toBe(0)
    expect(collections.branches.get("ag-a")?.sidebarOrder).toBe(1)
    expect(collections.branches.get("ag-b")?.sidebarOrder).toBe(2)
  })

  it("never touches an agent that belongs to a different repo", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("ag-a", baseBranch("ag-a", { repoId: "ws-1" }))
    collections.branches.set("ag-b", baseBranch("ag-b", { repoId: "ws-1" }))
    // An agent of another Repo, plus a stray id pointing at it sneaking
    // into ws-1's reorder — both must be left alone.
    collections.branches.set("other", baseBranch("other", { repoId: "ws-2" }))

    ops.reorderBranches("ws-1", ["ag-b", "other", "ag-a"])

    expect(collections.branches.get("other")?.sidebarOrder).toBeUndefined()
    expect(collections.branches.get("ag-b")?.sidebarOrder).toBe(0)
    expect(collections.branches.get("ag-a")?.sidebarOrder).toBe(2)
  })

  it("commits the renumber as one transaction under the canvas-ops origin", () => {
    const { doc, ops, collections } = makeHarness()
    collections.branches.set("ag-a", baseBranch("ag-a", { repoId: "ws-1" }))
    collections.branches.set("ag-b", baseBranch("ag-b", { repoId: "ws-1" }))
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.reorderBranches("ws-1", ["ag-b", "ag-a"])

    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
  })
})

describe("Group Workspace (#868)", () => {
  it("gives a Group created for Branches its first frame's Workspace", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.branches.set("agent-2", baseBranch("agent-2"))

    const { groupId } = ops.createFramesForAgents(
      [{ agentId: "agent-1" }, { agentId: "agent-2" }],
      { x: 0, y: 0 }
    )!

    expect(collections.iframeLayerGroups.get(groupId)?.branchId).toBe("agent-1")
  })

  it("makes a frame an exception without moving its Group's Workspace", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1", route: "/cart" })
    )
    collections.iframeLayers.set(
      "layer-2",
      baseLayer("layer-2", { branchId: "agent-1" })
    )
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])
    collections.iframeLayerGroups.update("group-1", { branchId: "agent-1" })

    ops.assignBranch("layer-1", "agent-2")
    expect(collections.iframeLayers.get("layer-1")?.branchId).toBe("agent-2")
    expect(collections.iframeLayers.get("layer-1")?.route).toBe("/cart")
    expect(collections.iframeLayerGroups.get("group-1")?.branchId).toBe(
      "agent-1"
    )

    // Following the Group again is picking the Group's Workspace.
    ops.assignBranch("layer-1", "agent-1")
    expect(collections.iframeLayers.get("layer-1")?.branchId).toBe("agent-1")
  })

  it("moves a Group of one's Workspace with its frame, and sets an unassigned Group's", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "markdown-layer", id: "doc-1" },
    ])
    collections.iframeLayerGroups.update("group-1", { branchId: "agent-1" })
    collections.iframeLayers.set("layer-2", baseLayer("layer-2"))
    collections.iframeLayers.set("layer-3", baseLayer("layer-3"))
    seedGroup(collections, "group-2", [
      { kind: "iframe-layer", id: "layer-2" },
      { kind: "iframe-layer", id: "layer-3" },
    ])

    ops.assignBranch("layer-1", "agent-2")
    ops.assignBranch("layer-2", "agent-3")

    expect(collections.iframeLayerGroups.get("group-1")?.branchId).toBe(
      "agent-2"
    )
    expect(collections.iframeLayerGroups.get("group-2")?.branchId).toBe(
      "agent-3"
    )
  })

  it("clears a removed Branch from the Groups that showed it", () => {
    const { ops, collections } = makeHarness()
    collections.branches.set("agent-1", baseBranch("agent-1"))
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    collections.iframeLayers.set(
      "layer-2",
      baseLayer("layer-2", { branchId: "agent-2" })
    )
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])
    collections.iframeLayerGroups.update("group-1", { branchId: "agent-1" })

    ops.removeBranch("agent-1")

    expect(
      collections.iframeLayerGroups.get("group-1")?.branchId
    ).toBeUndefined()
  })

  it("gives a split-off Group its leftmost frame's Workspace", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set(
      "layer-1",
      baseLayer("layer-1", { branchId: "agent-1" })
    )
    collections.iframeLayers.set(
      "layer-2",
      baseLayer("layer-2", { branchId: "agent-2" })
    )
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    const groupId = ops.splitToNewGroup(["layer-2"], { x: 0, y: 0 })

    expect(collections.iframeLayerGroups.get(groupId)?.branchId).toBe("agent-2")
  })
})

describe("assignGroupBranch", () => {
  function seedCartGroup() {
    const harness = makeHarness()
    const { collections } = harness
    collections.iframeLayers.set(
      "empty-cart",
      baseLayer("empty-cart", {
        branchId: "ws-ec",
        route: "/cart",
        iframeState: { step: 2 },
      })
    )
    collections.iframeLayers.set(
      "cart-mobile",
      baseLayer("cart-mobile", { branchId: "ws-ec", width: 390 })
    )
    collections.iframeLayers.set(
      "gift-card",
      baseLayer("gift-card", { branchId: "ws-gc", route: "/gift-cards" })
    )
    collections.iframeLayers.set("new-frame", baseLayer("new-frame"))
    collections.markdownLayers.set("brief", baseDoc("brief"))
    seedGroup(collections, "cart", [
      { kind: "iframe-layer", id: "empty-cart" },
      { kind: "iframe-layer", id: "cart-mobile" },
      { kind: "iframe-layer", id: "gift-card" },
      { kind: "iframe-layer", id: "new-frame" },
      { kind: "markdown-layer", id: "brief" },
    ])
    collections.iframeLayerGroups.update("cart", { branchId: "ws-ec" })
    return harness
  }

  it("moves the Group and every frame in it", () => {
    const { ops, collections } = seedCartGroup()

    ops.assignGroupBranch("cart", "ws-cp")

    const layer = (id: string) => collections.iframeLayers.get(id)
    expect(collections.iframeLayerGroups.get("cart")?.branchId).toBe("ws-cp")
    expect(layer("empty-cart")?.branchId).toBe("ws-cp")
    expect(layer("cart-mobile")?.branchId).toBe("ws-cp")
    // A frame with no Workspace yet follows its Group too.
    expect(layer("new-frame")?.branchId).toBe("ws-cp")
    expect(layer("gift-card")?.branchId).toBe("ws-cp")
    // Route, state and size survive the switch.
    expect(layer("empty-cart")?.route).toBe("/cart")
    expect(layer("empty-cart")?.iframeState).toEqual({ step: 2 })
    expect(layer("cart-mobile")?.width).toBe(390)
  })

  it("leaves a frame a Done Workspace hides where it is", () => {
    const { ops, collections } = seedCartGroup()
    collections.branches.set("ws-gc", { ...baseBranch("ws-gc"), doneAt: 1 })

    ops.assignGroupBranch("cart", "ws-cp")

    expect(collections.iframeLayers.get("gift-card")?.branchId).toBe("ws-gc")
    expect(collections.iframeLayers.get("empty-cart")?.branchId).toBe("ws-cp")
  })

  it("commits as one transaction, undone in one step", () => {
    const { doc, ops, collections } = seedCartGroup()
    const undo = new UndoManager(
      [
        doc.getMap(COLLECTION_KEYS.iframeLayers),
        doc.getMap(COLLECTION_KEYS.iframeLayerGroups),
      ],
      { trackedOrigins: new Set([CANVAS_OPS_ORIGIN]) }
    )
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.assignGroupBranch("cart", "ws-cp")
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])

    undo.undo()
    expect(collections.iframeLayerGroups.get("cart")?.branchId).toBe("ws-ec")
    expect(collections.iframeLayers.get("empty-cart")?.branchId).toBe("ws-ec")
    expect(collections.iframeLayers.get("cart-mobile")?.branchId).toBe("ws-ec")
    expect(collections.iframeLayers.get("new-frame")?.branchId).toBeUndefined()
  })

  it("is a no-op for a missing Group", () => {
    const { ops, collections } = seedCartGroup()
    ops.assignGroupBranch("missing", "ws-cp")
    expect(collections.iframeLayerGroups.has("missing")).toBe(false)
  })
})

describe("Unassigned Groups (#871)", () => {
  // "notes" names agent-1 and holds one frame beside a document; "cart" is
  // another Group on agent-2.
  function notesGroup() {
    const h = makeHarness()
    const { collections } = h
    collections.iframeLayers.set(
      "sketch",
      baseLayer("sketch", { branchId: "agent-1" })
    )
    collections.iframeLayers.set(
      "cart-1",
      baseLayer("cart-1", { branchId: "agent-2" })
    )
    collections.markdownLayers.set("brief", baseDoc("brief"))
    seedGroup(collections, "notes", [
      { kind: "iframe-layer", id: "sketch" },
      { kind: "markdown-layer", id: "brief" },
    ])
    collections.iframeLayerGroups.update("notes", { branchId: "agent-1" })
    seedGroup(collections, "cart", [{ kind: "iframe-layer", id: "cart-1" }])
    collections.iframeLayerGroups.update("cart", { branchId: "agent-2" })
    return h
  }

  it("clears a Group's Workspace when its last frame is moved out", () => {
    const { ops, collections } = notesGroup()

    ops.moveLayerToGroup("sketch", "cart")

    expect(collections.iframeLayerGroups.get("notes")?.branchId).toBeUndefined()
    // The moved frame keeps what it shows (#870).
    expect(collections.iframeLayers.get("sketch")?.branchId).toBe("agent-1")
  })

  it("clears a Group's Workspace when its last frame is split off", () => {
    const { ops, collections } = notesGroup()

    ops.splitToNewGroup(["sketch"], { x: 0, y: 0 })

    expect(collections.iframeLayerGroups.get("notes")?.branchId).toBeUndefined()
  })

  it("clears a Group's Workspace when its last frame is deleted", () => {
    const { ops, collections } = notesGroup()

    ops.removeLayers(["sketch"])

    expect(collections.iframeLayerGroups.get("notes")?.branchId).toBeUndefined()
  })

  it("lets the next frame to join a documents-only Group set its Workspace", () => {
    const { ops, collections } = notesGroup()
    ops.removeLayers(["sketch"])

    ops.moveLayerToGroup("cart-1", "notes")

    const notes = collections.iframeLayerGroups.get("notes")!
    const branch = groupBranchId(notes, collections.iframeLayers)
    expect(branch).toBe("agent-2")
  })

  it("keeps the Workspace while a frame is left", () => {
    const { ops, collections } = notesGroup()
    collections.iframeLayers.set("sketch-2", baseLayer("sketch-2"))
    collections.iframeLayerGroups.update("notes", {
      members: [
        { kind: "iframe-layer", id: "sketch" },
        { kind: "iframe-layer", id: "sketch-2" },
        { kind: "markdown-layer", id: "brief" },
      ],
    })

    ops.moveLayerToGroup("sketch", "cart")

    expect(collections.iframeLayerGroups.get("notes")?.branchId).toBe("agent-1")
  })

  it("sets an unassigned Group and all its frames from one pick", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("a", baseLayer("a"))
    collections.iframeLayers.set("b", baseLayer("b"))
    seedGroup(collections, "g", [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "b" },
    ])

    ops.assignGroupBranch("g", "agent-1")

    expect(collections.iframeLayerGroups.get("g")?.branchId).toBe("agent-1")
    expect(collections.iframeLayers.get("a")?.branchId).toBe("agent-1")
    expect(collections.iframeLayers.get("b")?.branchId).toBe("agent-1")
  })
})

describe("positions from the Canvas's Done-hidden view", () => {
  const f = (id: string) => ({ kind: "iframe-layer" as const, id })

  /**
   * Group [A, B, C] showing a live Workspace, where A is an exception frame
   * showing a Done one, so the Canvas and sidebar show [B, C]. D sits in a
   * Group of its own.
   */
  function withHiddenMember() {
    const h = makeHarness()
    const { collections } = h
    collections.branches.set("live", baseBranch("live"))
    collections.branches.set("done", baseBranch("done", { doneAt: 1 }))
    collections.iframeLayers.set("a", baseLayer("a", { branchId: "done" }))
    for (const id of ["b", "c", "d"])
      collections.iframeLayers.set(id, baseLayer(id, { branchId: "live" }))
    seedGroup(collections, "g", [f("a"), f("b"), f("c")])
    collections.iframeLayerGroups.update("g", { branchId: "live" })
    seedGroup(collections, "solo", [f("d")])
    return h
  }
  const members = (h: ReturnType<typeof withHiddenMember>, id: string) =>
    getGroupMembers(h.collections.iframeLayerGroups.get(id)!).map((m) => m.id)

  it("drops a Member between two shown Members around a hidden one", () => {
    const h = withHiddenMember()

    // Between B and C in the view [B, C].
    h.ops.moveLayerToGroup("d", "g", 1)

    expect(members(h, "g")).toEqual(["a", "b", "d", "c"])
  })

  it("drops a Member at the start and end of the view", () => {
    const start = withHiddenMember()
    start.ops.moveLayerToGroup("d", "g", 0)
    expect(members(start, "g")).toEqual(["a", "d", "b", "c"])

    const end = withHiddenMember()
    end.ops.moveLayerToGroup("d", "g", 2)
    expect(members(end, "g")).toEqual(["a", "b", "c", "d"])
  })

  it("reorders within the Group from a gap in the view", () => {
    // Drop B just after itself: nothing moves.
    const stay = withHiddenMember()
    stay.ops.moveLayerToGroup("b", "g", 1, { gapIncludesMover: true })
    expect(members(stay, "g")).toEqual(["a", "b", "c"])

    // Drop B after C.
    const after = withHiddenMember()
    after.ops.moveLayerToGroup("b", "g", 2, { gapIncludesMover: true })
    expect(members(after, "g")).toEqual(["a", "c", "b"])
  })

  it("keeps hidden Members in place when reordering from the view", () => {
    const h = withHiddenMember()

    h.ops.reorderGroupMembers("g", [f("c"), f("b")])

    expect(members(h, "g")).toEqual(["a", "c", "b"])
  })

  it("shows a reopened Workspace's frame in its old place", () => {
    const h = withHiddenMember()
    h.ops.moveLayerToGroup("d", "g", 0)
    h.ops.reorderGroupMembers("g", [f("c"), f("d"), f("b")])

    h.ops.patch("branches", "done", { doneAt: undefined })

    const view = hideDoneWorkspaceFrames({
      groups: h.collections.iframeLayerGroups.toArray(),
      iframeLayers: h.collections.iframeLayers.toArray(),
      branches: h.collections.branches.toArray(),
    })
    expect(
      getGroupMembers(view.groups.find((g) => g.id === "g")!).map((m) => m.id)
    ).toEqual(["a", "c", "d", "b"])
  })
})

describe("Pages (#1835)", () => {
  const groupsOn = (ops: ReturnType<typeof makeHarness>["ops"], id: string) =>
    ops.groupsOnPage(id).map((g) => g.id)

  it("reads a canvas with no pages as one “Page 1” holding every Group, with no write", () => {
    const { doc, ops, collections } = makeHarness()
    collections.iframeLayers.set("a", baseLayer("a"))
    seedGroup(collections, "g1", [{ kind: "iframe-layer", id: "a" }])
    let writes = 0
    doc.on("afterTransaction", () => writes++)

    const pages = ops.listPages()

    expect(pages.map((p) => p.name)).toEqual(["Page 1"])
    expect(groupsOn(ops, pages[0]!.id)).toEqual(["g1"])
    expect(writes).toBe(0)
    expect(collections.pages.toArray()).toEqual([])
  })

  it("adds “Page N” at the end, recording the first page alongside it in one step", () => {
    const { doc, ops } = makeHarness()
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    const second = ops.createPage()
    const third = ops.createPage()

    expect(ops.listPages().map((p) => [p.id, p.name])).toEqual([
      ["page-1", "Page 1"],
      [second, "Page 2"],
      [third, "Page 3"],
    ])
    expect(origins).toEqual([CANVAS_OPS_ORIGIN, CANVAS_OPS_ORIGIN])
  })

  it("never reuses a “Page N” name still on the list", () => {
    const { ops } = makeHarness()
    ops.createPage({ name: "Page 7" })

    ops.createPage()

    expect(ops.listPages().map((p) => p.name)).toEqual([
      "Page 1",
      "Page 7",
      "Page 8",
    ])
  })

  it("is undone in one step, taking the recorded first page with it", () => {
    const { doc, ops } = makeHarness()
    const undo = new UndoManager(doc.getMap(COLLECTION_KEYS.pages), {
      trackedOrigins: new Set([CANVAS_OPS_ORIGIN]),
    })

    ops.createPage()
    undo.undo()

    expect(ops.listPages().map((p) => p.name)).toEqual(["Page 1"])
  })

  it("keeps Groups without a page, or on a page that's gone, on the first page", () => {
    const { ops, collections } = makeHarness()
    const second = ops.createPage()
    collections.iframeLayers.set("a", baseLayer("a"))
    collections.iframeLayers.set("b", baseLayer("b"))
    collections.iframeLayers.set("c", baseLayer("c"))
    seedGroup(collections, "none", [{ kind: "iframe-layer", id: "a" }])
    seedGroup(collections, "gone", [{ kind: "iframe-layer", id: "b" }])
    seedGroup(collections, "second", [{ kind: "iframe-layer", id: "c" }])
    ops.patch("iframeLayerGroups", "gone", { pageId: "deleted" })
    ops.patch("iframeLayerGroups", "second", { pageId: second })

    expect(groupsOn(ops, "page-1")).toEqual(["none", "gone"])
    expect(groupsOn(ops, second)).toEqual(["second"])
  })

  it("puts Layers made on a page on that page, placed beside only its Groups", () => {
    const looking: { at?: string } = {}
    const { ops, collections } = makeHarness({
      currentPageId: () => looking.at,
    })
    // A wide Group on Page 1; the new page is empty.
    collections.iframeLayers.set("wide", baseLayer("wide", { width: 2000 }))
    seedGroup(collections, "first", [{ kind: "iframe-layer", id: "wide" }])
    const current = ops.createPage()
    looking.at = current
    collections.branches.set("agent-1", baseBranch("agent-1"))

    const frame = ops.createFrameForAgent("agent-1", { x: 0, y: 0 })
    const blank = ops.createBlankFrame(
      { x: 10, y: 10 },
      { width: 400, height: 300 }
    )
    const document = ops.createDocument(
      { x: 20, y: 20 },
      { width: 400, height: 300 }
    )
    const mockup = ops.createMockup({
      title: "M",
      width: 400,
      height: 300,
    })

    const onSecond = groupsOn(ops, current)
    expect(onSecond).toContain(frame.groupId)
    expect(onSecond).toContain(document.groupId)
    expect(onSecond).toContain(mockup?.groupId)
    expect(
      ops
        .groupsOnPage(current)
        .some((g) => getGroupMembers(g).some((m) => m.id === blank))
    ).toBe(true)
    expect(groupsOn(ops, "page-1")).toEqual(["first"])
    // Page 1's 2000px Group doesn't push the first Group on an empty page.
    expect(collections.iframeLayerGroups.get(frame.groupId)?.x).toBeLessThan(
      2000
    )
  })

  it("keeps Layers made without a current page on the first page", () => {
    const { ops } = makeHarness()
    const second = ops.createPage()

    const { groupId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 400, height: 300 }
    )

    expect(groupsOn(ops, "page-1")).toEqual([groupId])
    expect(groupsOn(ops, second)).toEqual([])
  })

  it("keeps a Layer split out of its Group on that Group's page", () => {
    const { ops, collections } = makeHarness()
    const second = ops.createPage()
    collections.iframeLayers.set("a", baseLayer("a"))
    collections.iframeLayers.set("b", baseLayer("b"))
    seedGroup(collections, "g", [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "b" },
    ])
    ops.patch("iframeLayerGroups", "g", { pageId: second })

    const split = ops.splitToNewGroup(["b"], { x: 900, y: 0 })

    expect(groupsOn(ops, second)).toEqual(["g", split])
  })
})

describe("renamePage", () => {
  it("renames a page, and records an unrecorded “Page 1” to rename it", () => {
    const { ops } = makeHarness()

    ops.renamePage("page-1", "  Homepage ")
    const second = ops.createPage()
    ops.renamePage(second, "Pricing")
    ops.renamePage(second, "   ")

    expect(ops.listPages().map((p) => p.name)).toEqual(["Homepage", "Pricing"])
  })
})

describe("Move to page (#1837)", () => {
  const groupsOn = (ops: ReturnType<typeof makeHarness>["ops"], id: string) =>
    ops.groupsOnPage(id).map((g) => g.id)

  // Page 1 holds "a" + "b" in Group "g" at (0, 0); the second page holds a
  // 400 × 300 frame "t" in Group "there" at (100, -80).
  function twoPages() {
    const h = makeHarness()
    const second = h.ops.createPage()
    for (const id of ["a", "b", "t"])
      h.collections.iframeLayers.set(id, baseLayer(id))
    seedGroup(h.collections, "g", [
      { kind: "iframe-layer", id: "a" },
      { kind: "iframe-layer", id: "b" },
    ])
    seedGroup(h.collections, "there", [{ kind: "iframe-layer", id: "t" }])
    h.ops.patch("iframeLayerGroups", "there", {
      pageId: second,
      x: 100,
      y: -80,
    })
    return { ...h, second }
  }

  it("moves a Group whole, right of the target page's content and top-aligned with it", () => {
    const { ops, collections, second } = twoPages()

    ops.moveGroupToPage("g", second)

    expect(groupsOn(ops, "page-1")).toEqual([])
    expect(groupsOn(ops, second).sort()).toEqual(["g", "there"])
    const g = collections.iframeLayerGroups.get("g")!
    // "there" ends at 100 + 400; one gap past it.
    expect({ x: g.x, y: g.y }).toEqual({ x: 550, y: -80 })
    expect(getGroupMembers(g).map((m) => m.id)).toEqual(["a", "b"])
  })

  it("keeps a Group's spot on an empty page", () => {
    const { ops, collections } = twoPages()
    const empty = ops.createPage()
    ops.patch("iframeLayerGroups", "g", { x: 30, y: 40 })

    ops.moveGroupToPage("g", empty)

    const g = collections.iframeLayerGroups.get("g")!
    expect([g.pageId, g.x, g.y]).toEqual([empty, 30, 40])
  })

  it("moves a single Layer into a new Group on the target page, leaving its Group the rest", () => {
    const { ops, collections, second } = twoPages()

    const moved = ops.moveLayersToPage(["b"], second)!

    expect(groupsOn(ops, "page-1")).toEqual(["g"])
    expect(groupsOn(ops, second).sort()).toEqual([moved, "there"].sort())
    expect(
      getGroupMembers(collections.iframeLayerGroups.get("g")!).map((m) => m.id)
    ).toEqual(["a"])
    const group = collections.iframeLayerGroups.get(moved)!
    expect(getGroupMembers(group).map((m) => m.id)).toEqual(["b"])
    expect({ x: group.x, y: group.y }).toEqual({ x: 550, y: -80 })
  })

  it("moves the whole Group when the Layers are all of it, committing no empty Group", () => {
    const { ops, collections, second } = twoPages()

    const moved = ops.moveLayersToPage(["b", "a"], second)

    expect(moved).toBe("g")
    expect(collections.iframeLayerGroups.get("g")?.pageId).toBe(second)
    expect(findEmptyGroups(collections)).toEqual([])
  })

  it("prunes a Group its last Layers leave across Groups", () => {
    const { ops, collections, second } = twoPages()
    collections.iframeLayers.set("c", baseLayer("c"))
    seedGroup(collections, "solo", [{ kind: "iframe-layer", id: "c" }])

    const moved = ops.moveLayersToPage(["c", "a"], second)!

    expect(collections.iframeLayerGroups.has("solo")).toBe(false)
    expect(findEmptyGroups(collections)).toEqual([])
    expect(
      getGroupMembers(collections.iframeLayerGroups.get(moved)!).map(
        (m) => m.id
      )
    ).toEqual(["c", "a"])
  })

  it("places what it moves clear of every Group on the target page", () => {
    const { ops, collections, second } = twoPages()
    collections.iframeLayers.set("tall", baseLayer("tall", { height: 2000 }))
    seedGroup(collections, "below", [{ kind: "iframe-layer", id: "tall" }])
    ops.patch("iframeLayerGroups", "below", { pageId: second, x: 0, y: 500 })

    ops.moveGroupToPage("g", second)

    const g = collections.iframeLayerGroups.get("g")!
    // The furthest right on that page is "there" (ends at 500) vs "below"
    // (ends at 400), so "g" starts past both, top-aligned with the topmost.
    expect({ x: g.x, y: g.y }).toEqual({ x: 550, y: -80 })
  })

  it("does nothing for its own page or a page that isn't there", () => {
    const { ops, collections } = twoPages()
    const before = collections.iframeLayerGroups.toArray()

    ops.moveGroupToPage("g", "page-1")
    ops.moveGroupToPage("g", "nope")
    expect(ops.moveLayersToPage(["a"], "page-1")).toBeUndefined()

    expect(collections.iframeLayerGroups.toArray()).toEqual(before)
  })

  it("moves in one undoable step", () => {
    const { doc, ops, collections, second } = twoPages()
    const undo = new UndoManager(
      doc.getMap(COLLECTION_KEYS.iframeLayerGroups),
      { trackedOrigins: new Set([CANVAS_OPS_ORIGIN]) }
    )

    ops.moveLayersToPage(["b"], second)
    undo.undo()

    expect(groupsOn(ops, "page-1")).toEqual(["g"])
    expect(
      getGroupMembers(collections.iframeLayerGroups.get("g")!).map((m) => m.id)
    ).toEqual(["a", "b"])
  })
})

describe("Page actions (#1836)", () => {
  const names = (ops: ReturnType<typeof makeHarness>["ops"]) =>
    ops.listPages().map((p) => p.name)

  /** Page 1 holds a frame, a document and a mockup; Page 2 a frame. */
  function seedPages() {
    const h = makeHarness()
    const { ops, collections, doc } = h
    const second = ops.createPage()
    collections.iframeLayers.set("a", baseLayer("a", { label: "Home" }))
    collections.iframeLayers.set("b", baseLayer("b"))
    collections.markdownLayers.set("d", baseDoc("d", { title: "Notes" }))
    setFragmentTitle(documentFragment(doc, "d"), "Notes")
    collections.mockupLayers.set("m", {
      id: "m",
      width: 300,
      height: 200,
      title: "Card",
      revision: 2,
    })
    seedGroup(collections, "g1", [
      { kind: "iframe-layer", id: "a" },
      { kind: "markdown-layer", id: "d" },
    ])
    seedGroup(collections, "g2", [{ kind: "mockup-layer", id: "m" }])
    seedGroup(collections, "g3", [{ kind: "iframe-layer", id: "b" }])
    ops.patch("iframeLayerGroups", "g3", { pageId: second })
    return { ...h, second }
  }

  it("reorders pages, keeping a page the list leaves out after the rest", () => {
    const { ops } = makeHarness()
    const second = ops.createPage()
    const third = ops.createPage()

    ops.reorderPages([third, "page-1"])

    expect(ops.listPages().map((p) => p.id)).toEqual([third, "page-1", second])
  })

  it("keeps Groups with no page of their own on their page when it moves down", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("a", baseLayer("a"))
    seedGroup(collections, "legacy", [{ kind: "iframe-layer", id: "a" }])
    const second = ops.createPage()

    ops.reorderPages([second, "page-1"])

    expect(ops.groupsOnPage("page-1").map((g) => g.id)).toEqual(["legacy"])
    expect(ops.groupsOnPage(second)).toEqual([])
  })

  it("duplicates a page below it with copies of its Layers and their bodies", () => {
    const { ops, collections, doc, second } = seedPages()

    const copy = ops.duplicatePage("page-1")!

    expect(names(ops)).toEqual(["Page 1", "Page 1 copy", "Page 2"])
    expect(ops.listPages()[1]!.id).toBe(copy)
    const groups = ops.groupsOnPage(copy)
    expect(groups.map((g) => g.name)).toEqual(["g1", "g2"])
    const [frame, document] = getGroupMembers(groups[0]!)
    expect(frame!.id).not.toBe("a")
    expect(collections.iframeLayers.get(frame!.id)?.label).toBe("Home")
    expect(getFragmentTitle(documentFragment(doc, document!.id))).toBe("Notes")
    const mockup = getGroupMembers(groups[1]!)[0]!
    // A new file whose folder the server copies from the original's (#1886).
    expect(collections.mockupLayers.get(mockup.id)).toMatchObject({
      fileId: mockup.id,
      title: "Card",
      copyOf: "m",
    })
    expect(collections.mockupLayers.get(mockup.id)?.revision).toBeUndefined()
    // The original page is untouched.
    expect(ops.groupsOnPage("page-1").map((g) => g.id)).toEqual(["g1", "g2"])
    expect(ops.groupsOnPage(second).map((g) => g.id)).toEqual(["g3"])
  })

  it("duplicates a canvas's only, unrecorded page", () => {
    const { ops } = makeHarness()

    const copy = ops.duplicatePage("page-1")

    expect(names(ops)).toEqual(["Page 1", "Page 1 copy"])
    expect(ops.listPages()[1]!.id).toBe(copy)
  })

  it("deletes a page and its Layers in one step, leaving chats alone", () => {
    const { ops, collections, doc, second } = seedPages()
    collections.chatSessions.set("c", baseChat("c"))
    let transactions = 0
    doc.on("afterTransaction", () => transactions++)

    expect(ops.deletePage("page-1")).toBe(true)

    expect(transactions).toBe(1)
    expect(names(ops)).toEqual(["Page 2"])
    expect(collections.iframeLayerGroups.toArray().map((g) => g.id)).toEqual([
      "g3",
    ])
    expect(collections.iframeLayers.toArray().map((l) => l.id)).toEqual(["b"])
    expect(collections.markdownLayers.toArray()).toEqual([])
    expect(collections.mockupLayers.toArray()).toEqual([])
    expect(collections.chatSessions.get("c")).toBeDefined()
    expect(ops.groupsOnPage(second).map((g) => g.id)).toEqual(["g3"])
  })

  it("won't delete the last page", () => {
    const { ops, collections } = makeHarness()
    collections.iframeLayers.set("a", baseLayer("a"))
    seedGroup(collections, "g", [{ kind: "iframe-layer", id: "a" }])

    expect(ops.deletePage("page-1")).toBe(false)
    const second = ops.createPage()
    ops.deletePage(second)
    expect(ops.deletePage("page-1")).toBe(false)

    expect(names(ops)).toEqual(["Page 1"])
    expect(collections.iframeLayerGroups.get("g")).toBeDefined()
  })

  it("⌘Z brings back a deleted page, its Layers, their bodies and its place", () => {
    const { ops, collections, doc, second } = seedPages()
    const third = ops.createPage()
    const undo = createCanvasUndo(doc)

    ops.deletePage(second)
    expect(names(ops)).toEqual(["Page 1", "Page 3"])
    undo.undo()

    expect(ops.listPages().map((p) => p.id)).toEqual(["page-1", second, third])
    expect(ops.groupsOnPage(second).map((g) => g.id)).toEqual(["g3"])
    expect(collections.iframeLayers.get("b")).toBeDefined()

    ops.savePageView("u1", "page-1", { x: 1, y: 2, zoom: 1 })
    ops.deletePage("page-1")
    expect(collections.pageViews.toArray()).toEqual([])
    undo.undo()
    expect(collections.pageViews.toArray().map((v) => v.pageId)).toEqual([
      "page-1",
    ])
    expect(ops.groupsOnPage("page-1").map((g) => g.id)).toEqual(["g1", "g2"])
    expect(getFragmentTitle(documentFragment(doc, "d"))).toBe("Notes")
    expect(collections.mockupLayers.get("m")?.revision).toBe(2)
    undo.destroy()
  })
})

describe("pageAfterDelete", () => {
  const page = (id: string, order: number) => ({ id, name: id, order })
  const before = [page("a", 0), page("b", 1), page("c", 2)]

  it("lands on the page above, or below when the first page went", () => {
    expect(pageAfterDelete(before, [page("a", 0), page("c", 2)], "b")).toBe("a")
    expect(pageAfterDelete(before, [page("b", 1), page("c", 2)], "a")).toBe("b")
  })
})

describe("files and views (#1883)", () => {
  /** A Document with a second view of its file in another Group. */
  function documentWithTwoViews() {
    const h = makeHarness()
    const { docId, groupId } = h.ops.createDocument(
      { x: 0, y: 0 },
      { width: 480, height: 640 }
    )
    h.ops.renameDocument(docId, "Plan")
    seedGroup(h.collections, "group-2", [{ kind: "iframe-layer", id: "f-1" }])
    h.collections.iframeLayers.set("f-1", baseLayer("f-1"))
    const viewId = h.ops.addFileView(docId, "group-2")!
    return { ...h, docId, groupId, viewId }
  }

  it("makes each new Document a file plus a view under the same id", () => {
    const { ops, collections } = makeHarness()

    const { docId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 480, height: 640 }
    )

    expect(collections.layerFiles.get(docId)).toEqual({
      id: docId,
      kind: "document",
      title: "",
    })
    expect(collections.markdownLayers.get(docId)?.fileId).toBe(docId)
    expect(ops.fileOf(docId)?.id).toBe(docId)
  })

  it("adds another view of a file at the end of a Group, the first view's size", () => {
    const { collections, docId, viewId } = documentWithTwoViews()

    expect(collections.markdownLayers.get(viewId)).toEqual({
      id: viewId,
      fileId: docId,
      width: 480,
      height: 640,
      title: "Plan",
    })
    expect(collections.iframeLayerGroups.get("group-2")?.members).toEqual([
      { kind: "iframe-layer", id: "f-1" },
      { kind: "markdown-layer", id: viewId },
    ])
  })

  it("shows the same body in both views, and a rename through either repaints both", () => {
    const { doc, ops, collections, docId, viewId } = documentWithTwoViews()

    ops.renameDocument(viewId, "Plan B")

    expect(collections.markdownLayers.get(docId)?.title).toBe("Plan B")
    expect(collections.markdownLayers.get(viewId)?.title).toBe("Plan B")
    // One body, keyed by the file: both views' editors bind to it.
    expect(getFragmentTitle(documentFragment(doc, docId))).toBe("Plan B")
    expect(ops.fileOf(viewId)?.id).toBe(docId)
  })

  it("renames a Mockup through any view, so every view repaints", () => {
    const { ops, collections } = makeHarness()
    const { mockupId } = ops.createMockup({
      title: "Hero",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 0 },
    })!
    seedGroup(collections, "group-2", [{ kind: "iframe-layer", id: "f-1" }])
    collections.iframeLayers.set("f-1", baseLayer("f-1"))
    const viewId = ops.addFileView(mockupId, "group-2")!

    expect(ops.updateMockup(viewId, { title: "Hero 2" })).toBe(true)

    expect(collections.mockupLayers.get(mockupId)?.title).toBe("Hero 2")
    expect(collections.mockupLayers.get(viewId)?.title).toBe("Hero 2")
  })

  it("keeps the file when one view is removed, and ⌘Z brings the view back", () => {
    const { doc, ops, collections, docId, viewId } = documentWithTwoViews()
    const undo = createCanvasUndo(doc)

    ops.removeDocuments([viewId])

    expect(collections.markdownLayers.has(viewId)).toBe(false)
    expect(collections.layerFiles.get(docId)?.title).toBe("Plan")
    undo.undo()
    expect(collections.markdownLayers.get(viewId)?.title).toBe("Plan")
    undo.destroy()
  })

  it("keeps the file Not on canvas when its last view is removed (#1884)", () => {
    const { doc, ops, collections, docId, viewId } = documentWithTwoViews()
    const undo = createCanvasUndo(doc)

    ops.removeDocuments([docId, viewId])

    expect(collections.markdownLayers.toArray()).toEqual([])
    expect(collections.layerFiles.get(docId)?.title).toBe("Plan")
    expect(ops.fileOf(docId)?.title).toBe("Plan")
    undo.undo()
    expect(collections.markdownLayers.has(docId)).toBe(true)
    expect(collections.markdownLayers.has(viewId)).toBe(true)
    undo.destroy()
  })

  it("deletes a file and every view in one step, and one ⌘Z brings them all back (#1884)", () => {
    const { doc, ops, collections, docId, groupId, viewId } =
      documentWithTwoViews()
    const undo = createCanvasUndo(doc)

    ops.deleteFiles([viewId])

    expect(collections.layerFiles.has(docId)).toBe(false)
    expect(collections.markdownLayers.toArray()).toEqual([])
    // The Document's own Group emptied and went; group-2 keeps its frame.
    expect(collections.iframeLayerGroups.has(groupId)).toBe(false)
    expect(collections.iframeLayerGroups.get("group-2")?.members).toEqual([
      { kind: "iframe-layer", id: "f-1" },
    ])

    undo.undo()
    expect(collections.layerFiles.get(docId)?.title).toBe("Plan")
    expect(collections.markdownLayers.get(viewId)?.title).toBe("Plan")
    expect(collections.markdownLayers.get(docId)?.title).toBe("Plan")
    expect(getFragmentTitle(documentFragment(doc, docId))).toBe("Plan")
    expect(collections.iframeLayerGroups.get("group-2")?.members).toEqual([
      { kind: "iframe-layer", id: "f-1" },
      { kind: "markdown-layer", id: viewId },
    ])
    undo.destroy()
  })

  it("deletes a file with no view by its own id", () => {
    const { ops, collections, docId, viewId } = documentWithTwoViews()
    ops.removeDocuments([docId, viewId])

    ops.deleteFiles([docId])

    expect(collections.layerFiles.has(docId)).toBe(false)
  })

  it("deletes a Mockup file with its views, its page kept for ⌘Z", () => {
    const { doc, ops, collections } = makeHarness()
    const { mockupId, groupId } = ops.createMockup({
      html: "<p>A</p>",
      title: "Hero",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 0 },
    })!
    const viewId = ops.duplicateView(mockupId)!
    const undo = createCanvasUndo(doc)

    ops.deleteFiles([mockupId])

    expect(collections.layerFiles.has(mockupId)).toBe(false)
    expect(collections.mockupLayers.toArray()).toEqual([])
    expect(collections.iframeLayerGroups.has(groupId)).toBe(false)
    undo.undo()
    expect(collections.mockupLayers.get(viewId)?.title).toBe("Hero")
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>A</p>")
    undo.destroy()
  })

  it("duplicates a view as another view of the same file", () => {
    const { ops, collections, docId, groupId } = documentWithTwoViews()

    const copy = ops.duplicateView(docId)!

    expect(collections.markdownLayers.get(copy)).toEqual({
      id: copy,
      fileId: docId,
      width: 480,
      height: 640,
      title: "Plan",
    })
    expect(collections.iframeLayerGroups.get(groupId)?.members).toEqual([
      { kind: "markdown-layer", id: docId },
      { kind: "markdown-layer", id: copy },
    ])
  })

  it("duplicates a Document as a new file, body and all", () => {
    const { doc, ops, collections, docId, viewId } = documentWithTwoViews()

    const copy = ops.duplicateDocument(viewId)!

    expect(collections.markdownLayers.get(copy)?.fileId).toBe(copy)
    expect(collections.layerFiles.get(copy)?.title).toBe("Plan copy")
    expect(getFragmentTitle(documentFragment(doc, copy))).toBe("Plan copy")
    expect(getFragmentTitle(documentFragment(doc, docId))).toBe("Plan")
    expect(
      collections.iframeLayerGroups.get("group-2")?.members
    ).toContainEqual({ kind: "markdown-layer", id: copy })
  })

  it("adds nothing for a missing file or Group", () => {
    const { ops, docId } = documentWithTwoViews()

    expect(ops.addFileView("gone", "group-2")).toBe(undefined)
    expect(ops.addFileView(docId, "gone")).toBe(undefined)
  })

  it("copies a page's Documents into new files, body and all", () => {
    const { doc, ops, collections, docId } = documentWithTwoViews()
    const pageId = ops.listPages()[0]!.id

    ops.duplicatePage(pageId)

    const copies = collections.markdownLayers
      .toArray()
      .filter((d) => d.fileId !== docId)
    expect(copies).toHaveLength(2)
    for (const copy of copies) {
      expect(copy.fileId).toBe(copy.id)
      expect(collections.layerFiles.get(copy.id)?.title).toBe("Plan")
      expect(getFragmentTitle(documentFragment(doc, copy.id))).toBe("Plan")
    }
  })
})
