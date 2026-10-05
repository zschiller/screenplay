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

import { baseBranch, baseChat, baseRepo } from "@/test/canvas/harness"
import {
  HOSTED_MIGRATIONS,
  setupSharedPgliteDb,
  type SharedPgliteDb,
} from "@/test/pglite"
import { getRoomCollections } from "@/lib/yjs/schema"
import type { PrLookup } from "./watch"

// PR Watch's live wiring (#1702) against real SQL: PGlite holds the rooms,
// members, chat logs and the KV index, an in-memory Y.Doc stands in for the
// Yjs host, and GitHub and the broadcast are faked.
const tokens = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: async () => null,
  getGitHubTokenForUser: async (userId: string) => tokens.get(userId) ?? null,
}))

const broadcasts = vi.hoisted(
  () => [] as Array<{ chatId: string; update: unknown }>
)
vi.mock("@/lib/agent/broadcast", () => ({
  broadcastAcpUpdate: async (
    _room: string,
    chatId: string,
    update: unknown
  ) => {
    broadcasts.push({ chatId, update })
  },
}))

// Turn Launch is faked at the wake's seam: it records who each wake acted
// for and answers as `wakes.outcome` says.
const wakes = vi.hoisted(() => ({
  outcome: "unavailable" as "started" | "busy" | "unavailable",
  calls: [] as Array<{ userId: string; chatId: string; message: string }>,
}))
vi.mock("@/lib/agent/turn-launch-live", () => ({
  launchPrWakeTurn: async (
    room: { userId: string },
    request: { chatId: string; message: string }
  ) => {
    wakes.calls.push({ userId: room.userId, ...request })
    return wakes.outcome
  },
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

const ROOM = "room-1"
const URL = "https://github.com/owner/repo/pull/7"

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
  tokens.clear()
  broadcasts.length = 0
  wakes.outcome = "unavailable"
  wakes.calls.length = 0
  const { db, schema } = await import("@/lib/db")
  await db.insert(schema.user).values([
    { id: "owner", name: "Owner", email: "owner@example.com" },
    { id: "maker", name: "Maker", email: "maker@example.com" },
  ])
  await db.insert(schema.room).values({ id: ROOM, name: "R", ownerId: "owner" })
  await db.insert(schema.roomMember).values([
    { roomId: ROOM, userId: "owner", role: "owner" },
    { roomId: ROOM, userId: "maker", role: "editor" },
  ])
  await db.insert(schema.agentChat).values({
    id: "chat-1",
    roomId: ROOM,
    sandboxName: "s",
    model: "m",
    systemPrompt: "",
  })
})

/** A Room whose Branch `b1` (made by `maker`) has PR #7 open, with its chat. */
function seedRoom() {
  const doc = new Y.Doc()
  const c = getRoomCollections(doc)
  c.repos.set("repo-1", baseRepo("repo-1"))
  c.branches.set(
    "b1",
    baseBranch("b1", {
      ref: "feat",
      createdBy: "maker",
      prNumber: 7,
      prUrl: URL,
      prState: "open",
    })
  )
  c.chatSessions.set("chat-1", baseChat("chat-1", { branchId: "b1" }))
  docs.set(ROOM, doc)
  return c
}

async function chatLog() {
  const { loadAcpHistory } = await import("@/lib/agent/persistence")
  return loadAcpHistory("chat-1")
}

describe("runPrWatch", () => {
  it("adds a PR event the Workspace can't wake for to its chat and echoes it", async () => {
    seedRoom()
    const { runPrWatch } = await import("./run")
    const { openRoomForPrWatchTick } = await import("@/lib/room-access")
    const failing: PrLookup = {
      number: 7,
      url: URL,
      state: "open",
      checks: "failing",
      failingChecks: ["lint"],
    }
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => failing)

    // The wake was tried as the Branch's owner first.
    expect(wakes.calls.map((c) => c.userId)).toEqual(["maker"])
    const log = await chatLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ role: "user" })
    expect(broadcasts).toEqual([
      {
        chatId: "chat-1",
        update: expect.objectContaining({
          sessionUpdate: "user_message_chunk",
          _meta: {
            screenplayUserTurn: {
              prEvent: { number: 7, kind: "checks_failed", detail: "lint" },
            },
          },
        }),
      },
    ])

    // The same state again changes nothing.
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => failing)
    expect(await chatLog()).toHaveLength(1)
  })

  it("holds a wake while the chat is busy and sends it on the next look", async () => {
    seedRoom()
    const { runPrWatch } = await import("./run")
    const { openRoomForPrWatchTick } = await import("@/lib/room-access")
    const conflict: PrLookup = {
      number: 7,
      url: URL,
      state: "open",
      conflict: true,
    }
    wakes.outcome = "busy"
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => conflict)
    expect(await chatLog()).toHaveLength(0)

    wakes.outcome = "started"
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => conflict)
    expect(wakes.calls).toHaveLength(2)
    expect(wakes.calls[1]!.message).toMatch(/^\[pr event: 7 conflict\]/)

    // Delivered once: nothing is held for a third look.
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => conflict)
    expect(wakes.calls).toHaveLength(2)
  })

  it("past the cap, shows the line and marks the PR as needing a person", async () => {
    const c = seedRoom()
    const { appendAcpMessage } = await import("@/lib/agent/persistence")
    for (let i = 0; i < 3; i++) {
      await appendAcpMessage("chat-1", {
        role: "user",
        content: [{ type: "text", text: "[pr event: 7 checks_failed] …" }],
      })
    }
    const { runPrWatch } = await import("./run")
    const { openRoomForPrWatchTick } = await import("@/lib/room-access")
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => ({
      number: 7,
      url: URL,
      state: "merged",
    }))

    expect(wakes.calls).toEqual([])
    expect(await chatLog()).toHaveLength(4)
    expect(c.branches.get("b1")?.prWakesPaused).toBe(7)
  })

  it("skips a look while another runs on the same Room", async () => {
    seedRoom()
    const { runPrWatch } = await import("./run")
    const { openRoomForPrWatchTick } = await import("@/lib/room-access")
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const first = runPrWatch(openRoomForPrWatchTick(ROOM), async () => {
      await held
      return null
    })
    // Let the first look take the lock before the second asks for it.
    await new Promise((r) => setTimeout(r, 50))
    expect(
      await runPrWatch(openRoomForPrWatchTick(ROOM), async () => null)
    ).toBeNull()
    release()
    expect(await first).not.toBeNull()
  })
})

describe("runPrWatchTick", () => {
  it("watches Rooms with an open PR, reading GitHub as the Branch's owner", async () => {
    const c = seedRoom()
    tokens.set("maker", "maker-token")
    tokens.set("owner", "owner-token")
    const { runPrWatch, runPrWatchTick } = await import("./run")
    const { openRoomForPrWatchTick } = await import("@/lib/room-access")
    // A first look (the browser's poll) puts the Room on the tick's list.
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => null)

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization")
      expect(auth).toBe("Bearer maker-token")
      if (url.includes("/pulls?")) {
        return Response.json([
          {
            number: 7,
            html_url: URL,
            state: "closed",
            merged_at: "2026-10-05T00:00:00Z",
            head: { sha: "abc" },
          },
        ])
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    try {
      expect(await runPrWatchTick()).toEqual({ rooms: 1 })
    } finally {
      vi.unstubAllGlobals()
    }

    expect(fetchMock).toHaveBeenCalled()
    expect(c.branches.get("b1")?.prState).toBe("merged")
    expect(await chatLog()).toHaveLength(1)
    // Nothing open is left, so the next tick has no Room to look at.
    expect(await runPrWatchTick()).toEqual({ rooms: 0 })
  })

  it("falls back to the Room owner's account when the Branch's owner left", async () => {
    seedRoom()
    tokens.set("maker", "maker-token")
    tokens.set("owner", "owner-token")
    const { db, schema } = await import("@/lib/db")
    const { and, eq } = await import("drizzle-orm")
    await db
      .delete(schema.roomMember)
      .where(
        and(
          eq(schema.roomMember.roomId, ROOM),
          eq(schema.roomMember.userId, "maker")
        )
      )
    const { runPrWatch, runPrWatchTick } = await import("./run")
    const { openRoomForPrWatchTick } = await import("@/lib/room-access")
    await runPrWatch(openRoomForPrWatchTick(ROOM), async () => null)

    const seen: Array<string | null> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("authorization"))
        return new Response(null, { status: 404 })
      })
    )
    try {
      await runPrWatchTick()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(seen).toEqual(["Bearer owner-token"])
  })
})
