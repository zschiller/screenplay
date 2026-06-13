import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"

// Persistence tests for `lib/pins`, driven against an in-memory PGlite — the
// same plain Postgres the desktop build runs — in the style of `lib/folders`.
// They pin the load-bearing guarantees of the first pinning slice (PRD #507):
// a pinned Room round-trips, re-pinning is idempotent, pins are private per
// user, and deleting a Room cascades its pin away.
describe("lib/pins persistence", () => {
  // Re-importing the db seam runs the PGlite migration boot; give the file
  // headroom so it stays reliable under full-suite CPU contention.
  vi.setConfig({ testTimeout: 30000 })

  beforeEach(() => {
    vi.resetModules()
    // The db handle is pinned to `globalThis` (one open per process), which
    // `resetModules` does not clear — so drop it to give each test a fresh
    // in-memory PGlite rather than a shared one carrying the prior test's rows.
    delete (globalThis as { __screenplayDbHandle?: unknown })
      .__screenplayDbHandle
    // Route the db seam to an ephemeral PGlite so importing `@/lib/db` doesn't
    // demand a Neon `DATABASE_URL`, and so the local migration set (which now
    // carries `pin`) runs.
    vi.stubEnv("SCREENPLAY_DB", "pglite")
    vi.stubEnv("PGLITE_DATA_DIR", "memory://")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // A pin row's user + room FKs both have to resolve, so seed two users and a
  // couple of Rooms (one shared, owned by Alice).
  async function seedGraph() {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db.insert(schema.user).values([
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ])
    await db.insert(schema.room).values([
      { id: "shared", name: "Shared", ownerId: "alice" },
      { id: "r2", name: "Second", ownerId: "alice" },
    ])
  }

  it("round-trips a pinned Room", async () => {
    await seedGraph()
    const { pinRoom, listPinsForUser } = await import("./pins")

    const pin = await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    expect(pin).toMatchObject({
      id: "p1",
      userId: "alice",
      kind: "room",
      targetId: "shared",
      position: 0,
    })
    expect(typeof pin.createdAt).toBe("number")

    expect(await listPinsForUser("alice")).toMatchObject([
      { kind: "room", targetId: "shared", position: 0 },
    ])
  })

  it("appends each new pin to the end of the list", async () => {
    await seedGraph()
    const { pinRoom, listPinsForUser } = await import("./pins")

    await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    const second = await pinRoom({ id: "p2", userId: "alice", roomId: "r2" })

    expect(second.position).toBe(1)
    expect((await listPinsForUser("alice")).map((p) => p.targetId)).toEqual([
      "shared",
      "r2",
    ])
  })

  it("is idempotent: re-pinning a Room returns the existing pin, no duplicate", async () => {
    await seedGraph()
    const { pinRoom, listPinsForUser } = await import("./pins")

    const first = await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    // A second pin call with a fresh id is a no-op: the existing pin comes back
    // and the list stays a single row.
    const again = await pinRoom({ id: "p2", userId: "alice", roomId: "shared" })

    expect(again).toEqual(first)
    expect(await listPinsForUser("alice")).toHaveLength(1)
  })

  it("unpins a Room", async () => {
    await seedGraph()
    const { pinRoom, unpin, listPinsForUser } = await import("./pins")

    await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    await unpin({ userId: "alice", kind: "room", targetId: "shared" })

    expect(await listPinsForUser("alice")).toEqual([])
  })

  it("keeps pins private: one user can neither see nor unpin another's", async () => {
    await seedGraph()
    const { pinRoom, unpin, listPinsForUser } = await import("./pins")

    // Both users pin the same shared Room into their own sidebars.
    await pinRoom({ id: "pa", userId: "alice", roomId: "shared" })
    await pinRoom({ id: "pb", userId: "bob", roomId: "shared" })

    // Each sees only their own pin.
    expect(await listPinsForUser("alice")).toMatchObject([
      { targetId: "shared" },
    ])
    expect(await listPinsForUser("bob")).toMatchObject([{ targetId: "shared" }])

    // Bob unpinning the shared Room only clears Bob's pin — Alice's survives.
    await unpin({ userId: "bob", kind: "room", targetId: "shared" })
    expect(await listPinsForUser("alice")).toHaveLength(1)
    expect(await listPinsForUser("bob")).toEqual([])
  })

  it("drops a Room's pin via cascade when the Room is deleted", async () => {
    await seedGraph()
    const { db, schema } = await import("@/lib/db")
    const { pinRoom, listPinsForUser } = await import("./pins")

    await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    await pinRoom({ id: "p2", userId: "alice", roomId: "r2" })

    // Deleting the Room cascades its pin away — no orphan-cleanup logic.
    await db.delete(schema.room).where(eq(schema.room.id, "shared"))

    expect((await listPinsForUser("alice")).map((p) => p.targetId)).toEqual([
      "r2",
    ])
  })
})
