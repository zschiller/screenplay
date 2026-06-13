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

  // A pin row's user + target FKs both have to resolve, so seed two users, a
  // couple of Rooms (one shared, owned by Alice), and a couple of Folders.
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
    await db.insert(schema.folder).values([
      { id: "f1", name: "Designs", ownerId: "alice" },
      { id: "f2", name: "Archive", ownerId: "alice" },
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

  it("reorders pins into dense positions in the given order", async () => {
    await seedGraph()
    const { db, schema } = await import("@/lib/db")
    const { pinRoom, reorderPins, listPinsForUser } = await import("./pins")

    // Seed a third Room so the reorder has a non-trivial run to re-pack.
    await db
      .insert(schema.room)
      .values({ id: "r3", name: "Third", ownerId: "alice" })
    await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    await pinRoom({ id: "p2", userId: "alice", roomId: "r2" })
    await pinRoom({ id: "p3", userId: "alice", roomId: "r3" })

    // Drag the last Room to the front: the whole reordered run comes back, and
    // the survivors re-pack to dense 0,1,2 in exactly that order.
    const reordered = await reorderPins({
      userId: "alice",
      ordered: [
        { kind: "room", targetId: "r3" },
        { kind: "room", targetId: "shared" },
        { kind: "room", targetId: "r2" },
      ],
    })
    expect(reordered.map((p) => [p.targetId, p.position])).toEqual([
      ["r3", 0],
      ["shared", 1],
      ["r2", 2],
    ])

    // The new order persists — a fresh fetch reads the same dense run.
    expect((await listPinsForUser("alice")).map((p) => p.targetId)).toEqual([
      "r3",
      "shared",
      "r2",
    ])
  })

  it("reorders only the caller's pins, never another user's", async () => {
    await seedGraph()
    const { pinRoom, reorderPins, listPinsForUser } = await import("./pins")

    // Both users pin the same two Rooms; their lists are independent.
    await pinRoom({ id: "a1", userId: "alice", roomId: "shared" })
    await pinRoom({ id: "a2", userId: "alice", roomId: "r2" })
    await pinRoom({ id: "b1", userId: "bob", roomId: "shared" })
    await pinRoom({ id: "b2", userId: "bob", roomId: "r2" })

    await reorderPins({
      userId: "alice",
      ordered: [
        { kind: "room", targetId: "r2" },
        { kind: "room", targetId: "shared" },
      ],
    })

    // Alice's order flipped; Bob's is untouched.
    expect((await listPinsForUser("alice")).map((p) => p.targetId)).toEqual([
      "r2",
      "shared",
    ])
    expect((await listPinsForUser("bob")).map((p) => p.targetId)).toEqual([
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

  it("round-trips a pinned Folder with kind 'folder'", async () => {
    await seedGraph()
    const { pinFolder, listPinsForUser } = await import("./pins")

    const pin = await pinFolder({ id: "p1", userId: "alice", folderId: "f1" })
    expect(pin).toMatchObject({
      id: "p1",
      userId: "alice",
      kind: "folder",
      targetId: "f1",
      position: 0,
    })

    expect(await listPinsForUser("alice")).toMatchObject([
      { kind: "folder", targetId: "f1", position: 0 },
    ])
  })

  it("appends a Folder pin after existing pins, regardless of kind", async () => {
    await seedGraph()
    const { pinRoom, pinFolder, listPinsForUser } = await import("./pins")

    // A Room pin then a Folder pin: the Folder lands at the end of the one list,
    // not in a separate per-kind sequence.
    await pinRoom({ id: "p1", userId: "alice", roomId: "shared" })
    const folderPin = await pinFolder({
      id: "p2",
      userId: "alice",
      folderId: "f1",
    })

    expect(folderPin.position).toBe(1)
    expect(
      (await listPinsForUser("alice")).map((p) => `${p.kind}:${p.targetId}`)
    ).toEqual(["room:shared", "folder:f1"])
  })

  it("is idempotent: re-pinning a Folder returns the existing pin, no duplicate", async () => {
    await seedGraph()
    const { pinFolder, listPinsForUser } = await import("./pins")

    const first = await pinFolder({ id: "p1", userId: "alice", folderId: "f1" })
    const again = await pinFolder({ id: "p2", userId: "alice", folderId: "f1" })

    expect(again).toEqual(first)
    expect(await listPinsForUser("alice")).toHaveLength(1)
  })

  it("keeps Folder pins private and unpins one owner-scoped", async () => {
    await seedGraph()
    const { db, schema } = await import("@/lib/db")
    const { pinFolder, unpin, listPinsForUser } = await import("./pins")
    // Bob owns his own folder so the FK resolves; pins are per-user either way.
    await db
      .insert(schema.folder)
      .values({ id: "fb", name: "Bob's", ownerId: "bob" })

    await pinFolder({ id: "pa", userId: "alice", folderId: "f1" })
    await pinFolder({ id: "pb", userId: "bob", folderId: "fb" })

    // Unpinning as Bob only clears Bob's pin — Alice's survives, scoped by user.
    await unpin({ userId: "bob", kind: "folder", targetId: "fb" })
    expect(await listPinsForUser("alice")).toMatchObject([{ targetId: "f1" }])
    expect(await listPinsForUser("bob")).toEqual([])
  })

  it("drops a Folder's pin via cascade when the Folder is deleted", async () => {
    await seedGraph()
    const { db, schema } = await import("@/lib/db")
    const { pinFolder, listPinsForUser } = await import("./pins")

    await pinFolder({ id: "p1", userId: "alice", folderId: "f1" })
    await pinFolder({ id: "p2", userId: "alice", folderId: "f2" })

    // Deleting the Folder cascades its pin away — no orphan-cleanup logic.
    await db.delete(schema.folder).where(eq(schema.folder.id, "f1"))

    expect((await listPinsForUser("alice")).map((p) => p.targetId)).toEqual([
      "f2",
    ])
  })

  it("rejects a pin row with both targets set or neither (exactly-one CHECK)", async () => {
    await seedGraph()
    const { db, schema } = await import("@/lib/db")

    // Both a Room and a Folder target: the CHECK requires exactly one.
    await expect(
      db.insert(schema.pin).values({
        id: "both",
        userId: "alice",
        roomId: "shared",
        folderId: "f1",
        position: 0,
      })
    ).rejects.toThrow()

    // Neither target: a pin must point at something.
    await expect(
      db.insert(schema.pin).values({
        id: "neither",
        userId: "alice",
        position: 0,
      })
    ).rejects.toThrow()
  })
})
