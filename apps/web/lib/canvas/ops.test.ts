import { describe, expect, it } from "vitest"
import { CANVAS_OPS_ORIGIN } from "@/lib/canvas/ops"
import {
  baseAgent,
  baseChat,
  baseDoc,
  baseLayer,
  baseWorkspace,
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

  it("deletes the Chat Sessions targeting the removed Documents and returns their ids", () => {
    const { ops, collections } = makeHarness()
    collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
    collections.chatSessions.set("chat-1", baseChat("chat-1", { markdownLayerId: "doc-1" }))
    collections.chatSessions.set("chat-2", baseChat("chat-2", { markdownLayerId: "other" }))
    seedGroup(collections, "group-1", [{ kind: "markdown-layer", id: "doc-1" }])

    const { removedChatIds } = ops.removeDocuments(["doc-1"])

    expect(removedChatIds).toEqual(["chat-1"])
    expect(collections.chatSessions.has("chat-1")).toBe(false)
    // A Chat Session targeting a different Document is untouched.
    expect(collections.chatSessions.has("chat-2")).toBe(true)
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

describe("removeAgent", () => {
  it("cascades: deletes the agent, its Iframe Layers and Chat Sessions, leaving no orphans or empty Groups", () => {
    const { ops, collections } = makeHarness()
    collections.agents.set("agent-1", baseAgent("agent-1"))
    collections.iframeLayers.set("layer-1", baseLayer("layer-1", { sandboxId: "agent-1" }))
    collections.iframeLayers.set("layer-2", baseLayer("layer-2", { sandboxId: "agent-1" }))
    collections.chatSessions.set("chat-1", baseChat("chat-1", { agentId: "agent-1" }))
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    const { removedChatIds } = ops.removeAgent("agent-1")

    expect(collections.agents.has("agent-1")).toBe(false)
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
    collections.agents.set("agent-1", baseAgent("agent-1"))
    collections.iframeLayers.set("layer-1", baseLayer("layer-1", { sandboxId: "agent-1" }))
    collections.iframeLayers.set("layer-2", baseLayer("layer-2", { sandboxId: "agent-2" }))
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])

    ops.removeAgent("agent-1")

    expect(collections.iframeLayers.has("layer-2")).toBe(true)
    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "layer-2" },
    ])
  })
})

describe("removeWorkspace", () => {
  it("cascades across every agent in the workspace, leaving no orphans or empty Groups", () => {
    const { ops, collections } = makeHarness()
    collections.workspaces.set("ws-1", baseWorkspace("ws-1"))
    collections.agents.set("agent-1", baseAgent("agent-1", { workspaceId: "ws-1" }))
    collections.agents.set("agent-2", baseAgent("agent-2", { workspaceId: "ws-1" }))
    collections.agents.set("agent-keep", baseAgent("agent-keep", { workspaceId: "ws-other" }))
    collections.iframeLayers.set("layer-1", baseLayer("layer-1", { sandboxId: "agent-1" }))
    collections.iframeLayers.set("layer-2", baseLayer("layer-2", { sandboxId: "agent-2" }))
    collections.iframeLayers.set("layer-keep", baseLayer("layer-keep", { sandboxId: "agent-keep" }))
    collections.chatSessions.set("chat-1", baseChat("chat-1", { agentId: "agent-1" }))
    collections.chatSessions.set("chat-2", baseChat("chat-2", { agentId: "agent-2" }))
    seedGroup(collections, "group-1", [
      { kind: "iframe-layer", id: "layer-1" },
      { kind: "iframe-layer", id: "layer-2" },
    ])
    seedGroup(collections, "group-keep", [{ kind: "iframe-layer", id: "layer-keep" }])

    const { removedChatIds } = ops.removeWorkspace("ws-1")

    expect(collections.workspaces.has("ws-1")).toBe(false)
    expect(collections.agents.has("agent-1")).toBe(false)
    expect(collections.agents.has("agent-2")).toBe(false)
    expect(collections.iframeLayers.has("layer-1")).toBe(false)
    expect(collections.iframeLayers.has("layer-2")).toBe(false)
    expect(removedChatIds.sort()).toEqual(["chat-1", "chat-2"])
    expect(collections.iframeLayerGroups.has("group-1")).toBe(false)
    // Another workspace's agent, layer, and Group are untouched.
    expect(collections.agents.has("agent-keep")).toBe(true)
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
