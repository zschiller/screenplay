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
// (`NEXT_PUBLIC_SCREENPLAY_LOCAL=1`) the multi-user surface collapses to the
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
  // `isLocalBuild` (lib/local-mode.ts) is a module-eval-time const, so the
  // env must be stubbed BEFORE anything imports it — hence in `beforeAll`,
  // before the harness boot and every test's dynamic `import()`. All tests in
  // this file run in local mode, so one stub for the file is correct and the
  // per-test `resetModules` the old shape needed falls away.
  let harness: SharedPgliteDb
  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SCREENPLAY_LOCAL", "1")
    // The desktop build also selects the local Yjs host; set it so importing
    // `rooms-actions` (which holds the `yjsHost` singleton) doesn't reach for a
    // Liveblocks secret the local build never has.
    vi.stubEnv("NEXT_PUBLIC_YJS_HOST", "local")
    harness = await setupSharedPgliteDb()
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
    const { shareRoom, listCollaborators } = await import("./rooms-actions")
    await expect(shareRoom("r1", "a@b.com")).rejects.toThrow(/local build/)
    await expect(listCollaborators("r1")).rejects.toThrow(/local build/)
  })

  it("excludes persisted comments but keeps thread reads safe (so the reference composer can mount)", async () => {
    // The element/selection "Send to Claude" path stays in the local build, so
    // the Comments component still mounts and reads threads — which must be a
    // safe empty result, never a query against the absent `thread` table.
    const { listThreads, createThreadWithFirstComment } =
      await import("./comments")
    await expect(listThreads("r1", "local")).resolves.toEqual([])
    // Persisting a comment thread is the multi-user half — it refuses.
    await expect(
      createThreadWithFirstComment({
        roomId: "r1",
        x: 0,
        y: 0,
        iframeLayerId: null,
        selector: null,
        offsetX: null,
        offsetY: null,
        branch: null,
        body: "hi",
        authorId: "local",
      })
    ).rejects.toThrow(/local build/)
  })
})
