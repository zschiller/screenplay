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
import { baseBranch, baseChat, baseRepo } from "@/test/canvas/harness"
import { getRoomCollections } from "@/lib/yjs/schema"
import type { BranchData } from "@/lib/types"

// Write to reopen (#1705) at the stream route's seam: a message to a Done
// Workspace Chat reopens its Branch, then launches its turn on the live
// sandbox. Real SQL for Room Access, an in-memory Y.Doc for the Yjs host;
// the sandbox and the turn itself are faked.
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

const sandbox = vi.hoisted(() => ({
  reconnect: [] as string[],
  stops: [] as string[],
  fails: null as string | null,
}))
vi.mock("@/lib/sandbox/lifecycle", () => ({
  reconnectSandbox: async (name: string) => {
    sandbox.reconnect.push(name)
    return sandbox.fails
      ? { success: false, error: sandbox.fails }
      : {
          success: true,
          value: { sandboxName: name, previewDomain: "preview.example" },
        }
  },
  stopWorkspaceSandbox: async (name: string) => {
    sandbox.stops.push(name)
    return { success: true, value: undefined }
  },
}))

/** The Branch as the turn found it when it launched. */
const launched = vi.hoisted(() => [] as Array<BranchData | undefined>)
vi.mock("@/lib/agent/turn-launch", () => ({
  launchTurn: async () => {
    launched.push(branch())
    return { kind: "started", runId: "run-1" }
  },
}))
vi.mock("@/lib/agent/turn-launch-live", () => ({
  liveTurnLaunchDeps: () => ({}),
  roomTurn: () => ({}),
  sketchTurn: () => ({}),
  sandboxTurn: () => ({}),
}))

const ROOM = "room-1"
const branch = () =>
  getRoomCollections(docs.get(ROOM) ?? new Y.Doc()).branches.get("b1")

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
  sandbox.reconnect.length = 0
  sandbox.stops.length = 0
  sandbox.fails = null
  session.userId = "owner"

  const { db, schema } = await import("@/lib/db")
  await db
    .insert(schema.user)
    .values([{ id: "owner", name: "Owner", email: "owner@example.com" }])
  await db
    .insert(schema.room)
    .values([{ id: ROOM, name: "R", ownerId: "owner" }])
  await db
    .insert(schema.roomMember)
    .values([{ roomId: ROOM, userId: "owner", role: "owner" }])
})

function seed(overrides: Partial<BranchData> = {}) {
  const doc = new Y.Doc()
  const c = getRoomCollections(doc)
  c.repos.set("repo-1", baseRepo("repo-1"))
  c.branches.set("b1", baseBranch("b1", overrides))
  c.chatSessions.set("chat-1", baseChat("chat-1", { branchId: "b1" }))
  docs.set(ROOM, doc)
}

const post = async () => {
  const { POST } = await import("@/app/api/agent/stream/route")
  return POST(
    new Request("http://localhost/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        roomId: ROOM,
        chatId: "chat-1",
        sandboxName: "sandbox-b1",
        message: "Now add Apple Pay",
      }),
    })
  )
}

describe("writing in a done chat (#1705)", () => {
  it("reopens the Branch, then launches the turn on its running sandbox", async () => {
    seed({ doneAt: 1, status: "stopped" })
    const res = await post()

    expect(res.status).toBe(200)
    expect(sandbox.reconnect).toEqual(["sandbox-b1"])
    expect(launched).toEqual([
      expect.objectContaining({
        status: "running",
        previewDomain: "preview.example",
      }),
    ])
    expect(launched[0]?.doneAt).toBeUndefined()
  })

  it("sends straight away to a chat that isn’t done", async () => {
    seed()
    const res = await post()

    expect(res.status).toBe(200)
    expect(sandbox.reconnect).toEqual([])
    expect(launched).toHaveLength(1)
  })

  it("says why when the sandbox won’t start, and sends nothing", async () => {
    seed({ doneAt: 1, status: "stopped" })
    sandbox.fails = "snapshot expired"
    const res = await post()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: "reopen_failed",
      message: "snapshot expired",
    })
    expect(launched).toEqual([])
    // Out of Done, on its error, as the menu's Reopen leaves it.
    expect(branch()).toMatchObject({
      status: "error",
      error: "snapshot expired",
    })
    expect(branch()?.doneAt).toBeUndefined()
  })
})

describe("after a turn that marked its chat done (#1705)", () => {
  it("stops the sandbox", async () => {
    seed({ doneAt: 1, status: "stopped" })
    const { settleDoneBranch } = await import("./reopen-live")
    const { openRoom } = await import("@/lib/room-access")
    await settleDoneBranch(await openRoom(ROOM), {
      sandboxName: "sandbox-b1",
      continuing: false,
    })
    expect(sandbox.stops).toEqual(["sandbox-b1"])
    expect(branch()?.doneAt).toBe(1)
  })

  it("reopens it instead when a person’s message carries the chat on", async () => {
    seed({ doneAt: 1, status: "stopped" })
    const { settleDoneBranch } = await import("./reopen-live")
    const { openRoom } = await import("@/lib/room-access")
    await settleDoneBranch(await openRoom(ROOM), {
      sandboxName: "sandbox-b1",
      continuing: true,
    })
    expect(sandbox.stops).toEqual([])
    expect(branch()?.status).toBe("running")
    expect(branch()?.doneAt).toBeUndefined()
  })

  it("leaves a chat that isn’t done alone", async () => {
    seed()
    const { settleDoneBranch } = await import("./reopen-live")
    const { openRoom } = await import("@/lib/room-access")
    await settleDoneBranch(await openRoom(ROOM), {
      sandboxName: "sandbox-b1",
      continuing: false,
    })
    expect(sandbox.stops).toEqual([])
  })
})
