import { describe, expect, it } from "vitest"

import { buildFixtureWorld, FIXTURE_IDS, type FixtureRoom } from "./world"
import { SCREENS } from "../screens"

/**
 * Referential integrity for the Fixture World.
 *
 * The seeder writes this world into a database with real foreign keys and into
 * Y.Docs the canvas reads structurally, so a typo'd id doesn't fail here — it
 * fails ten minutes later as a blank canvas, a Canvas filed into a Folder that
 * doesn't exist, or a capture run that dies on a constraint. The world is meant
 * to be *extended* by whoever needs one more state on screen, so these assert the
 * rules that extension has to keep, rather than pinning the exact contents.
 */
const PREVIEW_ORIGIN = "http://127.0.0.1:3948"
const world = buildFixtureWorld({
  previewOrigin: PREVIEW_ORIGIN,
  now: 1_700_000_000_000,
})

const allRoomDocs = (): Array<{
  room: FixtureRoom
  doc: NonNullable<FixtureRoom["doc"]>
}> => world.rooms.flatMap((room) => (room.doc ? [{ room, doc: room.doc }] : []))

describe("fixture world — identity", () => {
  it("gives every Canvas and Folder a distinct id", () => {
    const ids = [
      ...world.rooms.map((r) => r.id),
      ...world.folders.map((f) => f.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("uses stable literal ids, never generated ones", () => {
    // Regenerated ids would change `/[roomId]` between runs, so a before/after
    // pair would shoot two different sets of URLs and diff nothing.
    const again = buildFixtureWorld({
      previewOrigin: PREVIEW_ORIGIN,
      now: 1_700_000_000_000,
    })
    expect(again.rooms.map((r) => r.id)).toEqual(world.rooms.map((r) => r.id))
    expect(again).toEqual(world)
  })

  it("exposes every id the screen list builds URLs from", () => {
    const roomIds = new Set(world.rooms.map((r) => r.id))
    const folderIds = new Set(world.folders.map((f) => f.id))
    for (const id of Object.values(FIXTURE_IDS.rooms))
      expect(roomIds).toContain(id)
    for (const id of Object.values(FIXTURE_IDS.folders))
      expect(folderIds).toContain(id)
  })
})

describe("fixture world — referential integrity", () => {
  it("files every Canvas into a Folder that exists", () => {
    const folderIds = new Set(world.folders.map((f) => f.id))
    for (const room of world.rooms) {
      if (room.folderId) expect(folderIds).toContain(room.folderId)
    }
  })

  it("hangs every nested Folder off a Folder that exists", () => {
    const folderIds = new Set(world.folders.map((f) => f.id))
    for (const folder of world.folders) {
      if (folder.parentFolderId)
        expect(folderIds).toContain(folder.parentFolderId)
    }
  })

  it("points every Pin at exactly one existing target", () => {
    const roomIds = new Set(world.rooms.map((r) => r.id))
    const folderIds = new Set(world.folders.map((f) => f.id))
    for (const pin of world.pins) {
      // The `pin_exactly_one_target` CHECK constraint, asserted before the
      // insert rather than as a database error.
      expect(Number(pin.roomId != null) + Number(pin.folderId != null)).toBe(1)
      if (pin.roomId) expect(roomIds).toContain(pin.roomId)
      if (pin.folderId) expect(folderIds).toContain(pin.folderId)
    }
  })

  it("binds every Workspace to a Project in its own Canvas", () => {
    for (const { doc } of allRoomDocs()) {
      const repoIds = new Set((doc.repos ?? []).map((r) => r.id))
      for (const branch of doc.branches ?? []) {
        expect(repoIds).toContain(branch.repoId)
      }
    }
  })

  it("places every Layer in exactly one Group", () => {
    for (const { room, doc } of allRoomDocs()) {
      const members = (doc.iframeLayerGroups ?? []).flatMap((g) => g.members)
      const layerIds = [
        ...(doc.iframeLayers ?? []).map((l) => l.id),
        ...(doc.markdownLayers ?? []).map((l) => l.id),
      ]
      // A Layer no Group references gets wrapped in a synthetic single-member
      // Group by the on-load migration — which silently rewrites the canvas the
      // fixtures describe.
      expect(members.map((m) => m.id).sort(), `room ${room.id}`).toEqual(
        layerIds.sort()
      )
      expect(new Set(members.map((m) => m.id)).size).toBe(members.length)
    }
  })

  it("names a real Layer, of the declared kind, in every Group member", () => {
    for (const { doc } of allRoomDocs()) {
      const iframeIds = new Set((doc.iframeLayers ?? []).map((l) => l.id))
      const markdownIds = new Set((doc.markdownLayers ?? []).map((l) => l.id))
      for (const group of doc.iframeLayerGroups ?? []) {
        for (const member of group.members) {
          const pool = member.kind === "iframe-layer" ? iframeIds : markdownIds
          expect(pool).toContain(member.id)
        }
      }
    }
  })

  it("targets an existing Workspace or Document from every chat and plan", () => {
    for (const { doc } of allRoomDocs()) {
      const branchIds = new Set((doc.branches ?? []).map((b) => b.id))
      const markdownIds = new Set((doc.markdownLayers ?? []).map((l) => l.id))
      const chatIds = new Set((doc.chatSessions ?? []).map((c) => c.id))
      for (const chat of doc.chatSessions ?? []) {
        // A Chat Session targets exactly one of a Workspace or a Document.
        expect(
          Number(chat.branchId != null) + Number(chat.markdownLayerId != null)
        ).toBe(1)
        if (chat.branchId) expect(branchIds).toContain(chat.branchId)
        if (chat.markdownLayerId)
          expect(markdownIds).toContain(chat.markdownLayerId)
      }
      for (const plan of doc.plans ?? []) {
        expect(chatIds).toContain(plan.chatId)
        expect(branchIds).toContain(plan.branchId)
      }
    }
  })

  it("writes Document bodies only for Document Layers that exist", () => {
    for (const { doc } of allRoomDocs()) {
      const markdownIds = new Set((doc.markdownLayers ?? []).map((l) => l.id))
      for (const id of Object.keys(doc.markdownBodies ?? {})) {
        expect(markdownIds).toContain(id)
      }
    }
  })

  it("thumbnails only Iframe Layers of the same Canvas", () => {
    for (const room of world.rooms) {
      const iframeIds = new Set((room.doc?.iframeLayers ?? []).map((l) => l.id))
      for (const frameId of room.thumbnailFrames ?? []) {
        expect(iframeIds).toContain(frameId)
      }
    }
  })

  it("attaches every terminal tab and chat log to an existing Canvas and Workspace", () => {
    const roomIds = new Set(world.rooms.map((r) => r.id))
    const branchIds = new Set(
      allRoomDocs().flatMap(({ doc }) => (doc.branches ?? []).map((b) => b.id))
    )
    for (const tab of world.terminalTabs) {
      expect(roomIds).toContain(tab.roomId)
      expect(branchIds).toContain(tab.branch)
    }
    for (const chat of world.chats) {
      expect(roomIds).toContain(chat.roomId)
      const inDoc = allRoomDocs()
        .flatMap(({ doc }) => doc.chatSessions ?? [])
        .some((session) => session.id === chat.id)
      // The durable log's id IS the Y.Doc chat session's id — the two halves of
      // one chat. A log with no session renders nowhere.
      expect(inDoc, `chat ${chat.id} has no Y.Doc session`).toBe(true)
    }
  })

  it("keys a pending plan to the Y.Doc plan it stands for", () => {
    const docPlans = allRoomDocs().flatMap(({ doc }) => doc.plans ?? [])
    for (const chat of world.chats) {
      if (!chat.pendingPlan) continue
      // The pending tool call's id is the `planId` the client approves against,
      // and the Y.Doc plan's `toolEventId`. Drift between them and the canvas
      // and the chat card would be talking about two different plans.
      const docPlan = docPlans.find(
        (p) => p.toolEventId === chat.pendingPlan!.toolCallId
      )
      expect(
        docPlan,
        `no Y.Doc plan for ${chat.pendingPlan.toolCallId}`
      ).toBeDefined()
      expect(docPlan!.chatId).toBe(chat.id)
      expect(docPlan!.content).toBe(chat.pendingPlan.plan)
    }
  })
})

describe("fixture world — what the screens need", () => {
  it("covers every Workspace status the sidebar renders differently", () => {
    const statuses = new Set(
      allRoomDocs().flatMap(({ doc }) =>
        (doc.branches ?? []).map((b) => b.status)
      )
    )
    for (const status of ["running", "starting", "error", "stopped"]) {
      expect(statuses, `no Workspace is ${status}`).toContain(status)
    }
  })

  it("keeps one genuinely empty Canvas", () => {
    const empty = world.rooms.find((r) => r.id === FIXTURE_IDS.rooms.empty)
    expect(empty?.doc).toBeUndefined()
  })

  it("points every Workspace's preview at the fixture preview server", () => {
    // A `previewDomain` left pointing anywhere else is a frame that can never
    // load — and, if it resolved, an outbound request from a capture run.
    for (const { doc } of allRoomDocs()) {
      for (const branch of doc.branches ?? []) {
        expect(branch.previewDomain.startsWith(`${PREVIEW_ORIGIN}/`)).toBe(true)
      }
    }
  })

  it("gives every named screen a path the world can serve", () => {
    const roomIds = new Set(world.rooms.map((r) => r.id))
    const folderIds = new Set(world.folders.map((f) => f.id))
    for (const screen of SCREENS) {
      const [first, second] = screen.path.split("/").filter(Boolean)
      if (!first) continue // "/" — the home surface
      if (first === FIXTURE_IDS.missingRoom) {
        // The not-found screen: this one must stay missing.
        expect(roomIds).not.toContain(first)
        continue
      }
      if (first === "files" && second) expect(folderIds).toContain(second)
      else if (first === "play" && second) expect(roomIds).toContain(second)
      else if (!["files", "settings", "play"].includes(first)) {
        expect(roomIds, `screen ${screen.name}`).toContain(first)
      }
    }
  })

  it("names every screen and interaction once", () => {
    const names = SCREENS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
