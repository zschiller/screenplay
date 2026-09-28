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
import { getRoomCollections } from "@/lib/yjs/schema"

// Room Access (#900) against real SQL: the hosted migrations on PGlite supply
// `room_member`, and an in-memory Y.Doc per room stands in for the Yjs host.
// Only the session (request headers) and GitHub (the network) are faked.
const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: async () => session.userId,
  getGitHubToken: async () => "gh-token",
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

/** GitHub's compare and pulls endpoints, enough for both caches. */
const fetchMock = vi.fn(async (url: string) => {
  if (url.includes("/compare/")) {
    return Response.json({
      files: [{ additions: 7, deletions: 2 }],
    })
  }
  if (url.includes("/pulls?")) {
    return Response.json([
      {
        number: 42,
        html_url: "https://github.com/o/r/pull/42",
        state: "closed",
        merged_at: "2026-09-28T00:00:00Z",
        head: { sha: "abc" },
      },
    ])
  }
  return new Response(null, { status: 404 })
})

const ROOM = "room-1"
const diffQuery = {
  id: "b1",
  owner: "o",
  repo: "r",
  base: "main",
  head: "feat",
}
const prQuery = { id: "b1", owner: "o", repo: "r", branch: "feat" }

function seedBranchDoc() {
  const doc = new Y.Doc()
  getRoomCollections(doc).branches.set("b1", baseBranch("b1", { ref: "feat" }))
  docs.set(ROOM, doc)
  return doc
}

const snapshot = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc)

let harness: SharedPgliteDb
beforeAll(async () => {
  harness = await setupSharedPgliteDb({ migrationsFolder: HOSTED_MIGRATIONS })
}, 30000)
afterAll(async () => {
  await harness.close()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
beforeEach(async () => {
  await harness.reset()
  docs.clear()
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
  session.userId = null
})

async function seedRoomWithMember() {
  const { db, schema } = await import("@/lib/db")
  await db.insert(schema.user).values([
    { id: "member", name: "Member", email: "member@example.com" },
    { id: "outsider", name: "Outsider", email: "outsider@example.com" },
  ])
  await db
    .insert(schema.room)
    .values({ id: ROOM, name: "R", ownerId: "member" })
  await db
    .insert(schema.roomMember)
    .values({ roomId: ROOM, userId: "member", role: "owner" })
}

describe("Room Access — hosted build", () => {
  beforeEach(seedRoomWithMember)

  it("opens the room for a member with their role", async () => {
    session.userId = "member"
    const { openRoom } = await import("./room-access")
    const room = await openRoom(ROOM)
    expect(room).toMatchObject({
      roomId: ROOM,
      userId: "member",
      role: "owner",
    })

    seedBranchDoc()
    await room.mutateDoc(({ branches }) =>
      branches.update("b1", { prNumber: 1 })
    )
    expect(
      await room.readDoc(({ branches }) => branches.get("b1")?.prNumber)
    ).toBe(1)
  })

  it("rejects a signed-in non-member", async () => {
    session.userId = "outsider"
    const { openRoom } = await import("./room-access")
    await expect(openRoom(ROOM)).rejects.toThrow("don't have access")
  })

  it("rejects a request with no session", async () => {
    const { openRoom } = await import("./room-access")
    await expect(openRoom(ROOM)).rejects.toThrow("Unauthorized")
  })

  it("caches diff stats and PR status into the doc for a member", async () => {
    session.userId = "member"
    const doc = seedBranchDoc()
    const { compareBranches, listBranchPrs } = await import("./github-actions")

    await compareBranches(ROOM, [diffQuery])
    await listBranchPrs(ROOM, [prQuery])

    expect(getRoomCollections(doc).branches.get("b1")).toMatchObject({
      diffAdditions: 7,
      diffDeletions: 2,
      prNumber: 42,
      prUrl: "https://github.com/o/r/pull/42",
      prState: "merged",
    })
  })

  it("rejects a non-member's cache writes and leaves the doc unchanged", async () => {
    session.userId = "outsider"
    const doc = seedBranchDoc()
    const before = snapshot(doc)
    const { compareBranches, listBranchPrs } = await import("./github-actions")

    await expect(compareBranches(ROOM, [diffQuery])).rejects.toThrow(
      "don't have access"
    )
    await expect(listBranchPrs(ROOM, [prQuery])).rejects.toThrow(
      "don't have access"
    )

    expect(snapshot(doc)).toEqual(before)
    // Rejected before spending the caller's GitHub token on the room.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("Room Access — local build", () => {
  // `isLocalBuild` is read at module load, so stub the flag and re-import.
  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_SCREENPLAY_LOCAL", "1")
    vi.resetModules()
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("opens any room for the single local user as owner, with no member rows", async () => {
    session.userId = "local"
    const { openRoom } = await import("./room-access")
    expect(await openRoom(ROOM)).toMatchObject({
      userId: "local",
      role: "owner",
    })
  })

  it("caches diff stats and PR status the same as a member", async () => {
    session.userId = "local"
    const doc = seedBranchDoc()
    const { compareBranches, listBranchPrs } = await import("./github-actions")

    await compareBranches(ROOM, [diffQuery])
    await listBranchPrs(ROOM, [prQuery])

    expect(getRoomCollections(doc).branches.get("b1")).toMatchObject({
      diffAdditions: 7,
      prNumber: 42,
      prState: "merged",
    })
  })
})
