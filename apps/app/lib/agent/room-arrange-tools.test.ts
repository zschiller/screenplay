import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { resultLine } from "@/lib/agent/room-arrange-tools"
import { buildRoomTools, type RoomToolPorts } from "@/lib/agent/room-tools"
import { CHANGE_LOG_KEY, MAX_LOGGED_TURNS } from "@/lib/agent/room-change-log"
import { getGroupMembers } from "@/lib/canvas/layout"
import {
  documentFragment,
  fragmentBodyToPlainText,
  getFragmentTitle,
  replaceFragmentBodyPreservingTitle,
  seedDocumentFragment,
  setFragmentTitle,
} from "@/lib/yjs/fragment-text"
import {
  COLLECTION_KEYS,
  createRoomCollections,
  getRoomCollections,
} from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseLayer,
  findEmptyGroups,
  seedGroup,
} from "@/test/canvas/harness"

/**
 * The Coordinator's arrange tools and undo against a bare Room doc. The fake
 * ports hand each tool the doc's collections the way `RoomAccess.mutateDoc`
 * does on the server, where nothing observes the doc; every call to
 * {@link turn} builds a new turn's tool set.
 */
function room() {
  const doc = new Y.Doc()
  const ports: RoomToolPorts = {
    readDoc: async (fn) => fn(getRoomCollections(doc)),
    mutateDoc: async (fn) => fn(getRoomCollections(doc)),
    listTerminalTabs: async () => [],
    readChatTranscript: async () => [],
    readWorkspaceDiff: async () => "",
    readWorkspaceFile: async () => null,
    captureFrame: async () => {
      throw new Error("no browser")
    },
    readFrameCapture: async () => null,
    launchWorkspaceTurn: async () => {
      throw new Error("no Workspaces")
    },
  }
  const turn = () => {
    const tools = buildRoomTools("room-1", ports)
    return async (name: string, input: Record<string, unknown> = {}) =>
      (await tools[name]!.execute!(input, {
        toolCallId: "t",
        messages: [],
      })) as string
  }
  return {
    doc,
    turn,
    /** A fresh view per read, so assertions never see a stale snapshot. */
    get collections() {
      return createRoomCollections(doc)
    },
  }
}

/** The last id a tool result lists for the model. */
function lastId(result: string): string {
  return result.split("\nIds: ")[1]!.split(", ").at(-1)!
}

/** Every record the arrange tools can touch, plus document bodies, as JSON. */
function canvasState(doc: Y.Doc) {
  const maps = [
    COLLECTION_KEYS.iframeLayers,
    COLLECTION_KEYS.iframeLayerGroups,
    COLLECTION_KEYS.markdownLayers,
    COLLECTION_KEYS.chatSessions,
  ].map((key) => [key, doc.getMap(key).toJSON()])
  const bodies = Object.keys(doc.getMap("markdownLayers").toJSON()).map(
    (id) => [id, documentFragment(doc, id).toJSON()]
  )
  return { ...Object.fromEntries(maps), bodies: Object.fromEntries(bodies) }
}

/** A Group holding a Workspace frame and a document with a title and body. */
function seedCanvas(r: ReturnType<typeof room>) {
  const { doc, collections } = r
  collections.branches.set(
    "ws-1",
    baseBranch("ws-1", { title: "Checkout polish" })
  )
  collections.iframeLayers.set(
    "frame-1",
    baseLayer("frame-1", {
      branchId: "ws-1",
      route: "/settings",
      label: "Settings",
      scrollY: 120,
      iframeState: { tab: "billing" },
    })
  )
  collections.markdownLayers.set(
    "doc-1",
    baseDoc("doc-1", { title: "Launch spec" })
  )
  const fragment = documentFragment(doc, "doc-1")
  seedDocumentFragment(fragment)
  setFragmentTitle(fragment, "Launch spec")
  replaceFragmentBodyPreservingTitle(fragment, "Ship **Friday**.\n\n- QA")
  collections.chatSessions.set(
    "chat-doc-1",
    baseChat("chat-doc-1", { markdownLayerId: "doc-1", label: "Doc chat" })
  )
  seedGroup(collections, "group-1", [
    { kind: "iframe-layer", id: "frame-1" },
    { kind: "markdown-layer", id: "doc-1" },
  ])
  collections.iframeLayerGroups.update("group-1", {
    name: "Checkout",
    x: 40,
    branchId: "ws-1",
  })
}

describe("remove and undo", () => {
  it("puts a removed frame and document back exactly as they were", async () => {
    const r = room()
    seedCanvas(r)
    const original = canvasState(r.doc)

    const result = await r.turn()("remove", { ids: ["frame-1", "doc-1"] })
    expect(result).toBe('Removed frame "Settings", document "Launch spec".')
    expect(r.collections.iframeLayers.get("frame-1")).toBeUndefined()
    expect(r.collections.markdownLayers.get("doc-1")).toBeUndefined()
    expect(r.collections.chatSessions.get("chat-doc-1")).toBeUndefined()
    // The emptied Group went with them.
    expect(r.collections.iframeLayerGroups.get("group-1")).toBeUndefined()

    const undo = await r.turn()("undo_changes")
    expect(undo).toMatch(
      /^Undid: removed frame "Settings", document "Launch spec"\.\nIds: /
    )
    expect(canvasState(r.doc)).toEqual(original)
    expect(fragmentBodyToPlainText(documentFragment(r.doc, "doc-1"))).toMatch(
      /Friday[\s\S]*QA/
    )
    expect(findEmptyGroups(r.collections)).toEqual([])
  })

  it("never removes a Workspace, and refuses ids it doesn't know", async () => {
    const r = room()
    seedCanvas(r)
    const before = canvasState(r.doc)

    const result = await r.turn()("remove", { ids: ["frame-1", "ws-1"] })
    expect(result).toBe(
      "Error: no frame or document ws-1. Nothing was removed."
    )
    expect(canvasState(r.doc)).toEqual(before)
    expect(r.collections.branches.get("ws-1")).toBeDefined()
  })

  it("undoes an undo, and won't undo the same turn twice", async () => {
    const r = room()
    seedCanvas(r)

    await r.turn()("remove", { ids: ["frame-1"] })
    const removed = canvasState(r.doc)
    await r.turn()("undo_changes")
    expect(r.collections.iframeLayers.get("frame-1")).toBeDefined()

    // "Undo that" again undoes the undo.
    await r.turn()("undo_changes")
    expect(canvasState(r.doc)).toEqual(removed)

    // Both earlier turns are now undone; a named one says so.
    const list = await r.turn()("list_changes")
    expect(list.match(/\(undone\)/g)).toHaveLength(2)
    const firstTurn = list.match(/Turn \[([^\]]+)\] \(undone\):\n- Removed/)![1]
    expect(await r.turn()("undo_changes", { turn_id: firstTurn })).toBe(
      `Error: Turn ${firstTurn} was already undone.`
    )
  })

  it("says so when there's nothing to undo", async () => {
    const r = room()
    expect(await r.turn()("undo_changes")).toBe("Nothing to undo.")
  })
})

describe("arrange tools", () => {
  it("undoes a whole turn of arranging in one step", async () => {
    const r = room()
    seedCanvas(r)
    const original = canvasState(r.doc)

    const call = r.turn()
    await call("create_frames", {
      workspace_id: "ws-1",
      routes: ["/", "/checkout"],
    })
    await call("create_document", { title: "Notes" })
    await call("rename", { id: "frame-1", name: "Billing" })
    await call("rename", { id: "group-1", name: "Payments" })
    await call("rename", { id: "doc-1", name: "Launch plan" })
    await call("move_group", { group_id: "group-1", x: 900, y: 300 })

    expect(r.collections.iframeLayers.toArray()).toHaveLength(3)
    expect(r.collections.markdownLayers.toArray()).toHaveLength(2)
    expect(getFragmentTitle(documentFragment(r.doc, "doc-1"))).toBe(
      "Launch plan"
    )

    await r.turn()("undo_changes")
    expect(canvasState(r.doc).iframeLayers).toEqual(original.iframeLayers)
    expect(canvasState(r.doc).iframeLayerGroups).toEqual(
      original.iframeLayerGroups
    )
    expect(canvasState(r.doc).markdownLayers).toEqual(original.markdownLayers)
    expect(canvasState(r.doc).chatSessions).toEqual(original.chatSessions)
    // The document's heading follows its title back.
    expect(getFragmentTitle(documentFragment(r.doc, "doc-1"))).toBe(
      "Launch spec"
    )
  })

  it("creates frames for routes in one new Group", async () => {
    const r = room()
    seedCanvas(r)
    const result = await r.turn()("create_frames", {
      workspace_id: "ws-1",
      routes: ["/", "/checkout"],
    })
    expect(resultLine(result)).toBe(
      'Created frames "Home", "Checkout" for Checkout polish in a new Group.'
    )
    const groupId = lastId(result)
    const group = r.collections.iframeLayerGroups.get(groupId)!
    const frames = getGroupMembers(group).map(
      (m) => r.collections.iframeLayers.get(m.id)!
    )
    expect(frames.map((f) => [f.route, f.branchId])).toEqual([
      ["/", "ws-1"],
      ["/checkout", "ws-1"],
    ])
  })

  it("adds blank frames and documents to an existing Group", async () => {
    const r = room()
    seedCanvas(r)
    const call = r.turn()
    await call("create_frames", { group_id: "group-1" })
    await call("create_document", { group_id: "group-1", title: "Notes" })
    const members = getGroupMembers(
      r.collections.iframeLayerGroups.get("group-1")!
    )
    expect(members.map((m) => m.kind)).toEqual([
      "iframe-layer",
      "markdown-layer",
      "iframe-layer",
      "markdown-layer",
    ])
    const notes = r.collections.markdownLayers.get(members[3]!.id)!
    expect(notes.title).toBe("Notes")
  })

  it("groups, moves between and merges Groups, pruning emptied ones", async () => {
    const r = room()
    seedCanvas(r)
    const call = r.turn()

    const gathered = await call("move_to_group", { ids: ["doc-1"] })
    expect(resultLine(gathered)).toBe(
      'Gathered document "Launch spec" into a new Group.'
    )
    const newGroup = lastId(gathered)
    expect(
      getGroupMembers(r.collections.iframeLayerGroups.get(newGroup)!)
    ).toEqual([{ kind: "markdown-layer", id: "doc-1" }])

    await call("move_to_group", {
      ids: ["frame-1"],
      group_id: newGroup,
      index: 0,
    })
    expect(r.collections.iframeLayerGroups.get("group-1")).toBeUndefined()
    expect(
      getGroupMembers(r.collections.iframeLayerGroups.get(newGroup)!).map(
        (m) => m.id
      )
    ).toEqual(["frame-1", "doc-1"])

    await call("create_frames", {})
    const blankGroup = r.collections.iframeLayerGroups
      .toArray()
      .find((g) => g.id !== newGroup)!
    await call("merge_groups", {
      source_group_id: blankGroup.id,
      target_group_id: newGroup,
    })
    expect(r.collections.iframeLayerGroups.toArray()).toHaveLength(1)
    expect(findEmptyGroups(r.collections)).toEqual([])
  })

  it("logs nothing for a call that changes nothing", async () => {
    const r = room()
    seedCanvas(r)
    expect(await r.turn()("rename", { id: "nope", name: "X" })).toBe(
      "Error: no frame, Group or document nope."
    )
    expect(r.doc.getMap(CHANGE_LOG_KEY).size).toBe(0)
  })

  it(`keeps the last ${MAX_LOGGED_TURNS} turns`, async () => {
    const r = room()
    seedCanvas(r)
    for (let i = 0; i <= MAX_LOGGED_TURNS; i++) {
      await r.turn()("move_group", { group_id: "group-1", x: i, y: 0 })
    }
    expect(r.doc.getMap(CHANGE_LOG_KEY).size).toBe(MAX_LOGGED_TURNS)
  })
})

describe("read_canvas", () => {
  it("lists Groups, and the Group each frame and document is in", async () => {
    const r = room()
    seedCanvas(r)
    const summary = await r.turn()("read_canvas")
    expect(summary).toContain('- [group-1] "Checkout" · at 40, 0 · 2 items')
    expect(summary).toContain(
      '- [frame-1] "Settings" · /settings · 400×300 · Workspace ws-1 · Group group-1'
    )
    expect(summary).toContain('- [doc-1] "Launch spec" · Group group-1')
  })
})

describe("a member's own ⌘Z", () => {
  it("doesn't undo a Coordinator change", async () => {
    const r = room()
    seedCanvas(r)

    // A member's client: synced from the server, with the canvas's
    // UndoManager (lib/yjs/react.ts) tracking local edits.
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(r.doc), "provider")
    const undo = new Y.UndoManager(client.getMap(COLLECTION_KEYS.iframeLayers))

    const sv = Y.encodeStateVector(client)
    await r.turn()("remove", { ids: ["frame-1"] })
    Y.applyUpdate(client, Y.encodeStateAsUpdate(r.doc, sv), "provider")
    expect(client.getMap(COLLECTION_KEYS.iframeLayers).has("frame-1")).toBe(
      false
    )

    undo.undo()
    expect(client.getMap(COLLECTION_KEYS.iframeLayers).has("frame-1")).toBe(
      false
    )
  })
})
