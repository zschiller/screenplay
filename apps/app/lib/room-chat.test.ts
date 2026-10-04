import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import * as Y from "yjs"

import {
  HOSTED_MIGRATIONS,
  setupSharedPgliteDb,
  type SharedPgliteDb,
} from "@/test/pglite"
import { roomChatId } from "@/lib/chat/room-chat"
import { getRoomCollections } from "@/lib/yjs/schema"

// The Coordinator chat on a hosted canvas, against real SQL: the hosted
// migrations on PGlite supply `room_member`, and an in-memory Y.Doc per room
// stands in for the Yjs host. Only the session and the turn itself are faked.
const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: async () => session.userId,
}))

const docs = vi.hoisted(() => new Map<string, import("yjs").Doc>())
vi.mock("@/lib/yjs-host", async () => {
  const Y = await import("yjs")
  const docFor = (roomId: string) => {
    let doc = docs.get(roomId)
    if (!doc) docs.set(roomId, (doc = new Y.Doc()))
    return doc
  }
  return {
    yjsHost: {
      mutateDoc: async (roomId: string, fn: (doc: Y.Doc) => unknown) =>
        docFor(roomId).transact(() => fn(docFor(roomId))),
      readDoc: async (roomId: string, fn: (doc: Y.Doc) => unknown) =>
        fn(docFor(roomId)),
    },
  }
})

// The route's job here is access and target choice; the turn it launches is
// covered by the live-route seam tests.
const launched = vi.hoisted(() => [] as { kind: string; userId?: string }[])
vi.mock("@/lib/agent/turn-launch", () => ({
  launchTurn: async (_deps: unknown, _req: unknown, target: unknown) => {
    launched.push(target as { kind: string })
    return { kind: "started", runId: "run-1" }
  },
}))
vi.mock("@/lib/agent/turn-launch-live", () => ({
  liveTurnLaunchDeps: () => ({}),
  roomTurn: (input: { room: { userId: string } }) => ({
    kind: "room",
    userId: input.room.userId,
  }),
  markdownLayerTurn: () => ({ kind: "markdown-layer" }),
  sandboxTurn: () => ({ kind: "sandbox" }),
}))

const ROOM = "room-1"
const OTHER_ROOM = "room-2"

let harness: SharedPgliteDb
beforeAll(async () => {
  harness = await setupSharedPgliteDb({ migrationsFolder: HOSTED_MIGRATIONS })
}, 30000)
afterAll(async () => {
  await harness.close()
})
beforeEach(async () => {
  await harness.reset()
  docs.clear()
  launched.length = 0
  session.userId = null

  const { db, schema } = await import("@/lib/db")
  await db.insert(schema.user).values([
    { id: "owner", name: "Owner", email: "owner@example.com" },
    { id: "editor", name: "Editor", email: "editor@example.com" },
    { id: "outsider", name: "Outsider", email: "outsider@example.com" },
  ])
  await db.insert(schema.room).values([
    { id: ROOM, name: "R", ownerId: "owner" },
    { id: OTHER_ROOM, name: "Other", ownerId: "outsider" },
  ])
  await db.insert(schema.roomMember).values([
    { roomId: ROOM, userId: "owner", role: "owner" },
    { roomId: ROOM, userId: "editor", role: "editor" },
    { roomId: OTHER_ROOM, userId: "outsider", role: "owner" },
  ])
})

const roomChats = (roomId: string) =>
  getRoomCollections(docs.get(roomId) ?? new Y.Doc())
    .chatSessions.toArray()
    .filter((c) => c.target === "room")

describe("ensureRoomChatAction", () => {
  it("creates exactly one Coordinator chat per Room, however often it runs", async () => {
    const { ensureRoomChatAction } = await import("./room-chat-actions")
    session.userId = "owner"
    await Promise.all([ensureRoomChatAction(ROOM), ensureRoomChatAction(ROOM)])
    session.userId = "editor"
    const id = await ensureRoomChatAction(ROOM)

    expect(id).toBe(roomChatId(ROOM))
    expect(roomChats(ROOM)).toEqual([
      expect.objectContaining({
        id: roomChatId(ROOM),
        target: "room",
        label: "Coordinator",
      }),
    ])
  })

  it("keeps the existing record when it runs again", async () => {
    const { ensureRoomChatAction } = await import("./room-chat-actions")
    session.userId = "owner"
    await ensureRoomChatAction(ROOM)
    getRoomCollections(docs.get(ROOM)!).chatSessions.update(roomChatId(ROOM), {
      model: "picked-model",
    })
    await ensureRoomChatAction(ROOM)

    expect(roomChats(ROOM)[0].model).toBe("picked-model")
  })

  it("refuses a non-member without touching the Room", async () => {
    const { ensureRoomChatAction } = await import("./room-chat-actions")
    session.userId = "outsider"
    await expect(ensureRoomChatAction(ROOM)).rejects.toThrow(
      "don’t have access"
    )
    expect(docs.has(ROOM)).toBe(false)
  })
})

describe("posting in the Coordinator chat", () => {
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/agent/stream/route")
    return POST(
      new Request("http://localhost/api/agent/stream", {
        method: "POST",
        body: JSON.stringify({ message: "What’s on this canvas?", ...body }),
      })
    )
  }

  it("lets every member of the canvas post", async () => {
    for (const userId of ["owner", "editor"]) {
      session.userId = userId
      const res = await post({
        roomId: ROOM,
        chatId: roomChatId(ROOM),
        target: "room",
      })
      expect(res.status).toBe(200)
    }
    expect(launched).toEqual([
      { kind: "room", userId: "owner" },
      { kind: "room", userId: "editor" },
    ])
  })

  it("refuses a non-member", async () => {
    session.userId = "outsider"
    const res = await post({
      roomId: ROOM,
      chatId: roomChatId(ROOM),
      target: "room",
    })
    expect(res.status).toBe(403)
    expect(launched).toEqual([])
  })

  it("refuses another Room’s Coordinator chat id, from any target", async () => {
    session.userId = "outsider"
    const asRoom = await post({
      roomId: OTHER_ROOM,
      chatId: roomChatId(ROOM),
      target: "room",
    })
    const asSandbox = await post({
      roomId: OTHER_ROOM,
      chatId: roomChatId(ROOM),
      sandboxName: "sandbox-1",
    })
    expect(asRoom.status).toBe(400)
    expect(asSandbox.status).toBe(400)
    expect(launched).toEqual([])
  })
})
