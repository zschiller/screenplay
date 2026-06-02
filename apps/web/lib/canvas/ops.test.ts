import { describe, expect, it } from "vitest"
import { CANVAS_OPS_ORIGIN } from "@/lib/canvas/ops"
import {
  MIN_IFRAME_LAYER_HEIGHT,
  MIN_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { routeToLabel } from "@/lib/route-utils"
import { documentFragment, getFragmentTitle } from "@/lib/yjs/fragment-text"
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

  it("deletes the Chat Sessions targeting the removed Documents and returns their ids", () => {
    const { ops, collections } = makeHarness()
    collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { markdownLayerId: "doc-1" })
    )
    collections.chatSessions.set(
      "chat-2",
      baseChat("chat-2", { markdownLayerId: "other" })
    )
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

describe("removeBranch", () => {
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

describe("createDocument", () => {
  it("seeds the body fragment at the right key and returns a coherent { docId, groupId, chatId }", () => {
    const { ops, collections, doc } = makeHarness()

    const { docId, groupId, chatId } = ops.createDocument(
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

    // A Chat Session targeting the Document is pre-created and returned.
    expect(collections.chatSessions.get(chatId)?.markdownLayerId).toBe(docId)
    expect(findEmptyGroups(collections)).toEqual([])
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

describe("saveViewport", () => {
  it("writes the viewport singleton under the canvas-ops origin", () => {
    const { ops, collections, doc } = makeHarness()
    const origins: unknown[] = []
    doc.on("afterTransaction", (tr) => origins.push(tr.origin))

    ops.saveViewport({ x: 12, y: 34, zoom: 1.5 })

    expect(collections.savedViewport.get()).toEqual({ x: 12, y: 34, zoom: 1.5 })
    expect(origins).toEqual([CANVAS_OPS_ORIGIN])
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
