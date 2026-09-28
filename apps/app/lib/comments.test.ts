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

import { baseBranch } from "@/test/canvas/harness"
import {
  HOSTED_MIGRATIONS,
  setupSharedPgliteDb,
  type SharedPgliteDb,
} from "@/test/pglite"
import { readCommentsRead, readCommentsRevision } from "@/lib/comments-signals"
import { getRoomCollections } from "@/lib/yjs/schema"

// The Comments module (#911) against real SQL: the hosted migrations on PGlite
// supply `thread`, `comment`, `thread_read` and `room_member`, and an in-memory
// Y.Doc per room stands in for the Yjs host. Only the session is faked.
const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/auth-helpers", async () => {
  const { inArray } = await import("drizzle-orm")
  return {
    getUserId: async () => session.userId,
    getUsersByIds: async (ids: string[]) => {
      const { db, schema } = await import("@/lib/db")
      return ids.length === 0
        ? []
        : db.select().from(schema.user).where(inArray(schema.user.id, ids))
    },
  }
})

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

const ROOM = "room-1"
const roomDoc = () => {
  let doc = docs.get(ROOM)
  if (!doc) docs.set(ROOM, (doc = new Y.Doc()))
  return doc
}

let harness: SharedPgliteDb
beforeAll(async () => {
  harness = await setupSharedPgliteDb({ migrationsFolder: HOSTED_MIGRATIONS })
}, 30000)
afterAll(() => harness.close())
beforeEach(async () => {
  await harness.reset()
  docs.clear()
  session.userId = null
  const { db, schema } = await import("@/lib/db")
  await db.insert(schema.user).values([
    { id: "ann", name: "Ann", email: "ann@example.com" },
    { id: "bob", name: "Bob", email: "bob@example.com" },
    { id: "outsider", name: "Outsider", email: "outsider@example.com" },
  ])
  await db.insert(schema.room).values({ id: ROOM, name: "R", ownerId: "ann" })
  await db.insert(schema.roomMember).values([
    { roomId: ROOM, userId: "ann", role: "owner" },
    { roomId: ROOM, userId: "bob", role: "editor" },
  ])
})

const comments = () => import("./comments")

function as(userId: string) {
  session.userId = userId
}

async function startThread(body = "first") {
  const { createThread } = await comments()
  return createThread({
    roomId: ROOM,
    x: 10,
    y: 20,
    iframeLayerId: null,
    selector: null,
    offsetX: null,
    offsetY: null,
    body,
  })
}

async function rowCounts() {
  const { db, schema } = await import("@/lib/db")
  const [threads, commentRows, reads] = await Promise.all([
    db.select().from(schema.thread),
    db.select().from(schema.comment),
    db.select().from(schema.threadRead),
  ])
  return {
    threads: threads.length,
    comments: commentRows.length,
    reads: reads.length,
  }
}

describe("creating a thread", () => {
  it("stores the thread, its first comment and the starter's read mark", async () => {
    as("ann")
    const thread = await startThread("  hello  ")
    expect(thread).toMatchObject({
      roomId: ROOM,
      x: 10,
      y: 20,
      createdBy: "ann",
      unread: false,
      comments: [{ authorId: "ann", authorName: "Ann", body: "hello" }],
    })
    expect(await rowCounts()).toEqual({ threads: 1, comments: 1, reads: 1 })
  })

  it("is atomic: when the comment can't be stored, neither is the thread", async () => {
    as("ann")
    // Postgres refuses a NUL byte in text, failing the comment insert.
    await expect(startThread("bad\u0000body")).rejects.toThrow()
    expect(await rowCounts()).toEqual({ threads: 0, comments: 0, reads: 0 })
  })
})

describe("author scoping", () => {
  it("lets only a comment's author edit or delete it, and refuses everyone else the same way", async () => {
    as("ann")
    const thread = await startThread()
    const { appendComment, editComment, deleteComment, NotYourCommentError } =
      await comments()
    const reply = await appendComment({ threadId: thread.id, body: "second" })

    as("bob")
    await expect(
      editComment({ commentId: reply.id, body: "hijacked" })
    ).rejects.toThrow(NotYourCommentError)
    await expect(deleteComment({ commentId: reply.id })).rejects.toThrow(
      NotYourCommentError
    )

    as("ann")
    await editComment({ commentId: reply.id, body: "second, edited" })
    const { listThreads } = await comments()
    const [listed] = await listThreads(ROOM)
    expect(listed!.comments.map((c) => c.body)).toEqual([
      "first",
      "second, edited",
    ])
    expect(listed!.comments[1]!.editedAt).not.toBeNull()
  })

  it("lets only the thread's starter delete the thread", async () => {
    as("ann")
    const thread = await startThread()
    const { deleteThread, NotYourCommentError } = await comments()

    as("bob")
    await expect(deleteThread(thread.id)).rejects.toThrow(NotYourCommentError)
    expect((await rowCounts()).threads).toBe(1)

    as("ann")
    await deleteThread(thread.id)
    expect(await rowCounts()).toEqual({ threads: 0, comments: 0, reads: 0 })
  })

  it("lets the sender delete the agent's reply but not edit it", async () => {
    as("ann")
    const thread = await startThread()
    const { settleAgentThreads, editComment, deleteComment, listThreads } =
      await comments()
    const { openRoom } = await import("@/lib/room-access")
    await settleAgentThreads({
      room: await openRoom(ROOM),
      chatId: "chat-1",
      authorId: "ann",
      replies: new Map([[thread.id, { body: "Done.", commit: null }]]),
      failed: [],
    })
    const agentReply = (await listThreads(ROOM))[0]!.comments[1]!
    expect(agentReply).toMatchObject({ fromAgent: true, authorName: "Agent" })

    await expect(
      editComment({ commentId: agentReply.id, body: "Not the agent" })
    ).rejects.toThrow("Only its author")
    await deleteComment({ commentId: agentReply.id })
    expect((await rowCounts()).comments).toBe(1)
  })
})

describe("deleting comments", () => {
  it("keeps the thread while other comments remain", async () => {
    as("ann")
    const thread = await startThread()
    const { appendComment, deleteComment } = await comments()
    const reply = await appendComment({ threadId: thread.id, body: "two" })
    await deleteComment({ commentId: reply.id })
    expect(await rowCounts()).toMatchObject({ threads: 1, comments: 1 })
  })

  it("deletes the thread with its last comment", async () => {
    as("ann")
    const thread = await startThread()
    const { deleteComment, listThreads } = await comments()
    await deleteComment({ commentId: thread.comments[0]!.id })
    expect(await rowCounts()).toEqual({ threads: 0, comments: 0, reads: 0 })
    expect(await listThreads(ROOM)).toEqual([])
  })
})

describe("unread", () => {
  it("tracks each member's read state as replies arrive", async () => {
    const { appendComment, listThreads, markThreadRead, markThreadUnread } =
      await comments()
    as("ann")
    const thread = await startThread()
    expect((await listThreads(ROOM))[0]!.unread).toBe(false)

    as("bob")
    expect((await listThreads(ROOM))[0]!.unread).toBe(true)
    await markThreadRead(thread.id)
    expect((await listThreads(ROOM))[0]!.unread).toBe(false)

    // Timestamps are millisecond-grained; let the reply land after the read.
    await new Promise((r) => setTimeout(r, 5))
    as("ann")
    await appendComment({ threadId: thread.id, body: "ping" })

    as("bob")
    expect((await listThreads(ROOM))[0]!.unread).toBe(true)
    await markThreadRead(thread.id)
    await markThreadUnread(thread.id)
    expect((await listThreads(ROOM))[0]!.unread).toBe(true)
  })
})

describe("non-members", () => {
  it("are refused every read and write, and nothing changes", async () => {
    as("ann")
    const thread = await startThread()
    const commentId = thread.comments[0]!.id
    const before = await rowCounts()
    const revision = readCommentsRevision(roomDoc())
    const c = await comments()

    as("outsider")
    const attempts: Array<() => Promise<unknown>> = [
      () => c.listThreads(ROOM),
      () => startThread(),
      () => c.appendComment({ threadId: thread.id, body: "hi" }),
      () => c.editComment({ commentId, body: "hi" }),
      () => c.deleteComment({ commentId }),
      () => c.setThreadResolved({ threadId: thread.id, resolved: true }),
      () => c.deleteThread(thread.id),
      () => c.markThreadRead(thread.id),
      () => c.markThreadUnread(thread.id),
    ]
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow("don't have access")
    }
    expect(await rowCounts()).toEqual(before)
    expect(readCommentsRevision(roomDoc())).toBe(revision)
    expect(readCommentsRead(roomDoc(), "outsider")).toBe(0)
  })

  it("are refused with no session", async () => {
    const { listThreads } = await comments()
    await expect(listThreads(ROOM)).rejects.toThrow("Unauthorized")
  })
})

describe("listing", () => {
  it("places the old feed's threads on their Workspace without writing", async () => {
    const { db, schema } = await import("@/lib/db")
    await db.insert(schema.thread).values([
      { id: "feed-1", roomId: ROOM, branch: "feat", createdBy: "ann" },
      { id: "feed-2", roomId: ROOM, branch: "gone", createdBy: "ann" },
    ])
    getRoomCollections(roomDoc()).branches.set(
      "ws-1",
      baseBranch("ws-1", { ref: "feat" })
    )
    const stateBefore = Y.encodeStateAsUpdate(roomDoc())

    as("ann")
    const { listThreads } = await comments()
    const byId = new Map((await listThreads(ROOM)).map((t) => [t.id, t]))
    expect(byId.get("feed-1")).toMatchObject({
      workspaceId: "ws-1",
      snapshot: null,
    })
    expect(byId.get("feed-2")).toMatchObject({
      workspaceId: null,
      snapshot: "Play mode on gone",
    })

    const stored = await db.select().from(schema.thread)
    expect(stored.map((t) => t.branch).sort()).toEqual(["feat", "gone"])
    expect(Y.encodeStateAsUpdate(roomDoc())).toEqual(stateBefore)
  })
})

describe("doorbells", () => {
  it("content changes ring the room doorbell once each", async () => {
    const c = await comments()
    as("ann")
    const thread = await startThread()
    expect(readCommentsRevision(roomDoc())).toBe(1)

    const reply = await c.appendComment({ threadId: thread.id, body: "b" })
    await c.editComment({ commentId: reply.id, body: "b2" })
    await c.setThreadResolved({ threadId: thread.id, resolved: true })
    await c.deleteComment({ commentId: reply.id })
    await c.deleteThread(thread.id)
    expect(readCommentsRevision(roomDoc())).toBe(6)
    expect(readCommentsRead(roomDoc(), "ann")).toBe(0)
  })

  it("read changes ring only the acting user's doorbell", async () => {
    const c = await comments()
    as("ann")
    const thread = await startThread()
    const revision = readCommentsRevision(roomDoc())

    as("bob")
    await c.markThreadRead(thread.id)
    await c.markThreadUnread(thread.id)
    expect(readCommentsRead(roomDoc(), "bob")).toBe(2)
    expect(readCommentsRead(roomDoc(), "ann")).toBe(0)
    expect(readCommentsRevision(roomDoc())).toBe(revision)
  })
})
