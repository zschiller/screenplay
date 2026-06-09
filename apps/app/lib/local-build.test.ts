import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The access-model half of issue #417: behind the build-time switch
// (`NEXT_PUBLIC_SCREENPLAY_LOCAL=1`) the multi-user surface collapses to the
// single seeded local user. These exercise the public seams every request
// flows through — session resolution and room access — against the local
// PGlite backend, with no OAuth and no `room_member` table.
describe("local build — access model", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("NEXT_PUBLIC_SCREENPLAY_LOCAL", "1")
    // Route the db seam to an ephemeral PGlite so importing `@/lib/db` doesn't
    // demand a Neon `DATABASE_URL`, and so the local migration set runs.
    vi.stubEnv("SCREENPLAY_DB", "pglite")
    vi.stubEnv("PGLITE_DATA_DIR", "memory://")
    // The desktop build also selects the local Yjs host; set it so importing
    // `rooms-actions` (which holds the `yjsHost` singleton) doesn't reach for a
    // Liveblocks secret the local build never has.
    vi.stubEnv("NEXT_PUBLIC_YJS_HOST", "local")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

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
  }, 30000)

  it("refuses the sharing actions as a backstop", async () => {
    const { shareRoom, listCollaborators } = await import("./rooms-actions")
    await expect(shareRoom("r1", "a@b.com")).rejects.toThrow(/local build/)
    await expect(listCollaborators("r1")).rejects.toThrow(/local build/)
  })
})
