import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

// `lib/comments.ts` binds to the live Neon handle and Yjs host at import time.
// This suite drives the real mutations against a fake DB and an in-memory Y.Doc
// per room, asserting on the *doorbell state* each mutation leaves behind — the
// observable contract (#152), independent of how roomId is derived internally.

/**
 * A chainable Drizzle stand-in. Every query builder method returns the same
 * proxy, and awaiting any terminal (`.returning()`, `.limit()`, `.orderBy()`,
 * an `onConflict` upsert) resolves to a single canned row carrying a roomId.
 * It is deliberately order-insensitive: the test asserts which doorbell rings,
 * not the sequence of SQL calls.
 */
const NOW = new Date("2026-05-30T00:00:00Z")
const ROW = {
  id: "comment-1",
  threadId: "thread-1",
  roomId: "room-1",
  authorId: "author-1",
  body: "hi",
  x: null,
  y: null,
  iframeLayerId: null,
  selector: null,
  offsetX: null,
  offsetY: null,
  documentId: null,
  anchorStart: null,
  anchorEnd: null,
  quotedText: null,
  branch: null,
  resolved: false,
  resolvedAt: null,
  createdBy: "author-1",
  createdAt: NOW,
  updatedAt: NOW,
  editedAt: null,
}

function makeDbProxy(): unknown {
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve([ROW]).then(resolve, reject)
      }
      return () => proxy
    },
    apply() {
      return proxy
    },
  })
  return proxy
}

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual("@/lib/db/schema")
  return { db: makeDbProxy(), schema }
})

vi.mock("@/lib/auth-helpers", () => ({
  getUsersByIds: async () => [],
}))

// One bare Y.Doc per room. The signal wrappers only touch `collections.doc`,
// so a `{ doc }` stand-in is enough.
const docs = new Map<string, Y.Doc>()
function roomDoc(roomId: string): Y.Doc {
  let doc = docs.get(roomId)
  if (!doc) {
    doc = new Y.Doc()
    docs.set(roomId, doc)
  }
  return doc
}

vi.mock("@/lib/yjs/server", () => ({
  mutateRoomDoc: async (
    roomId: string,
    fn: (collections: { doc: Y.Doc }) => unknown
  ) => fn({ doc: roomDoc(roomId) }),
}))

import {
  appendComment,
  createThreadWithFirstComment,
  deleteComment,
  deleteThread,
  editComment,
  markThreadRead,
  markThreadUnread,
  setThreadResolved,
} from "@/lib/comments"
import { readCommentsRead, readCommentsRevision } from "@/lib/comments-signals"

beforeEach(() => {
  docs.clear()
})

describe("read-state mutations ring only the per-user doorbell", () => {
  it("markThreadRead rings the acting user's read doorbell, not the room counter", async () => {
    await markThreadRead({ threadId: "thread-1", userId: "user-1" })

    const doc = roomDoc("room-1")
    expect(readCommentsRead(doc, "user-1")).toBe(1)
    expect(readCommentsRevision(doc)).toBe(0)
  })

  it("markThreadUnread rings the acting user's read doorbell, not the room counter", async () => {
    await markThreadUnread({ threadId: "thread-1", userId: "user-1" })

    const doc = roomDoc("room-1")
    expect(readCommentsRead(doc, "user-1")).toBe(1)
    expect(readCommentsRevision(doc)).toBe(0)
  })
})

describe("content mutations ring the room doorbell exactly once", () => {
  // Each case runs a content mutation and asserts the room-global counter
  // advanced by exactly one and no per-user read doorbell was touched. A
  // mutation that forgets to signal (or rings the wrong/extra doorbell) fails
  // here — this is the coverage net for the seam.
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      "createThreadWithFirstComment",
      () =>
        createThreadWithFirstComment({
          roomId: "room-1",
          x: 0,
          y: 0,
          iframeLayerId: null,
          selector: null,
          offsetX: null,
          offsetY: null,
          branch: null,
          body: "hello",
          authorId: "author-1",
        }),
    ],
    [
      "appendComment",
      () =>
        appendComment({
          threadId: "thread-1",
          authorId: "author-1",
          body: "hi",
        }),
    ],
    [
      "editComment",
      () =>
        editComment({
          commentId: "comment-1",
          authorId: "author-1",
          body: "edited",
        }),
    ],
    [
      "deleteComment",
      () => deleteComment({ commentId: "comment-1", authorId: "author-1" }),
    ],
    [
      "setThreadResolved",
      () => setThreadResolved({ threadId: "thread-1", resolved: true }),
    ],
    ["deleteThread", () => deleteThread("thread-1")],
  ]

  for (const [name, run] of cases) {
    it(`${name} bumps commentsRevision once and rings no read doorbell`, async () => {
      await run()

      const doc = roomDoc("room-1")
      expect(readCommentsRevision(doc)).toBe(1)
      expect(readCommentsRead(doc, "author-1")).toBe(0)
    })
  }
})
