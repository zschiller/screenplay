import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { setupSharedPgliteDb, type SharedPgliteDb } from "../test/pglite"

// The access-model half of issue #417: behind the build-time switch
// (`NEXT_PUBLIC_SCREENPLAY_PROFILE=desktop`) the multi-user surface collapses to the
// single seeded local user. These exercise the public seams every request
// flows through — session resolution and room access — against the local
// PGlite backend, with no OAuth and no `room_member` table.
describe("local build — access model", () => {
  // Boot one in-memory PGlite for the whole file and truncate between tests,
  // rather than the old `resetModules` + fresh ~2s WASM boot per test. The
  // shared harness pre-seeds the `@/lib/db` handle on `globalThis`, which the
  // seam prefers over `selectDb()`, so no `SCREENPLAY_DB`/`PGLITE_DATA_DIR`
  // stubbing is needed. `beforeAll` gets headroom so the one boot stays
  // reliable under full-suite CPU contention.
  //
  // The build profile (lib/capabilities.ts) is a module-eval-time const, so the
  // env must be stubbed BEFORE anything imports it — hence in `beforeAll`,
  // before the harness boot and every test's dynamic `import()`. All tests in
  // this file run in local mode, so one stub for the file is correct and the
  // per-test `resetModules` the old shape needed falls away.
  let harness: SharedPgliteDb
  let roomsActions: typeof import("./rooms-actions")
  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SCREENPLAY_PROFILE", "desktop")
    // The desktop build also selects the local Yjs host; set it so importing
    // `rooms-actions` (which holds the `yjsHost` singleton) doesn't reach for a
    // Liveblocks secret the local build never has.
    vi.stubEnv("NEXT_PUBLIC_YJS_HOST", "local")
    harness = await setupSharedPgliteDb()
    // `rooms-actions` pulls in Room teardown, the repository library and the
    // Yjs host: a cold import can take over 5s, so it loads here under the
    // boot's budget rather than timing out the test that uses it.
    roomsActions = await import("./rooms-actions")
  }, 30000)

  afterAll(async () => {
    await harness.close()
    vi.unstubAllEnvs()
  })

  beforeEach(() => harness.reset())

  it("resolves every request to the single seeded local user", async () => {
    const { getUserId, requireUserId, getCurrentSession } =
      await import("./auth-helpers")
    expect(await getUserId()).toBe("local")
    expect(await requireUserId()).toBe("local")
    const session = await getCurrentSession()
    expect(session?.user.id).toBe("local")
  })

  it("collapses canAccess and requireMember to the local owner", async () => {
    const { canAccess, requireMember } = await import("./rooms")
    // No db read needed — access is unconditional for the local user.
    expect(await canAccess("any-room", "local")).toBe(true)
    expect(await requireMember("any-room", "local")).toMatchObject({
      userId: "local",
      role: "owner",
    })
  })

  it("creates rooms without membership and lists every room for the user", async () => {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db.insert(schema.user).values({
      id: "local",
      name: "Local User",
      email: "local@localhost",
    })

    const { createRoom, listRoomsForUser } = await import("./rooms")
    await createRoom({ id: "r1", name: "Canvas A", ownerId: "local" })
    await createRoom({ id: "r2", name: "Canvas B", ownerId: "local" })

    const rooms = await listRoomsForUser("local")
    expect(rooms.map((r) => r.id).sort()).toEqual(["r1", "r2"])
  })

  it("refuses the sharing actions as a backstop", async () => {
    const { shareRoom, listCollaborators } = roomsActions
    await expect(shareRoom("r1", "a@b.com")).rejects.toThrow(/desktop app/)
    await expect(listCollaborators("r1")).rejects.toThrow(/desktop app/)
  })

  it("persists the host's comment threads (Sharing's viewers comment too, #1934)", async () => {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db.insert(schema.user).values({
      id: "local",
      name: "Local User",
      email: "local@localhost",
    })
    await db.insert(schema.room).values({ id: "r1", ownerId: "local" })
    const { listThreads, createThread } = await import("./comments")
    await expect(listThreads("r1")).resolves.toEqual([])
    const thread = await createThread({
      roomId: "r1",
      x: 0,
      y: 0,
      iframeLayerId: null,
      selector: null,
      offsetX: null,
      offsetY: null,
      body: "hi",
    })
    expect(thread.comments).toMatchObject([
      { authorId: "local", authorName: "Local User", body: "hi" },
    ])
    expect((await listThreads("r1")).map((t) => t.id)).toEqual([thread.id])
  })
})
