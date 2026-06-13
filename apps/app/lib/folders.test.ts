import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Persistence tests for `lib/folders`, driven against an in-memory PGlite — the
// same plain Postgres the desktop build runs — in the style of the local-build
// db tests. They pin the two load-bearing guarantees: a created folder
// round-trips, and listing is scoped to its owner so one user's tree can never
// surface in another's.
describe("lib/folders persistence", () => {
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
    // carries `folder`) runs.
    vi.stubEnv("SCREENPLAY_DB", "pglite")
    vi.stubEnv("PGLITE_DATA_DIR", "memory://")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function seedUsers() {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db.insert(schema.user).values([
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ])
  }

  it("round-trips a created folder", async () => {
    await seedUsers()
    const { createFolder, getFolder } = await import("./folders")

    const created = await createFolder({
      id: "f1",
      name: "Designs",
      ownerId: "alice",
    })
    expect(created).toMatchObject({
      id: "f1",
      name: "Designs",
      ownerId: "alice",
      parentFolderId: null,
    })
    expect(typeof created.createdAt).toBe("number")

    const fetched = await getFolder("f1")
    expect(fetched).toMatchObject({ id: "f1", name: "Designs" })
  })

  it("lists only the folders owned by the given user", async () => {
    await seedUsers()
    const { createFolder, listFoldersForUser } = await import("./folders")

    await createFolder({ id: "a1", name: "Alice One", ownerId: "alice" })
    await createFolder({ id: "a2", name: "Alice Two", ownerId: "alice" })
    await createFolder({ id: "b1", name: "Bob One", ownerId: "bob" })

    const aliceFolders = await listFoldersForUser("alice")
    expect(aliceFolders.map((f) => f.id).sort()).toEqual(["a1", "a2"])

    const bobFolders = await listFoldersForUser("bob")
    expect(bobFolders.map((f) => f.id)).toEqual(["b1"])
  })

  it("scopes getOwnedFolder to the owner", async () => {
    await seedUsers()
    const { createFolder, getOwnedFolder } = await import("./folders")

    await createFolder({ id: "a1", name: "Alice One", ownerId: "alice" })

    expect(await getOwnedFolder("a1", "alice")).toMatchObject({ id: "a1" })
    // Bob can't reach Alice's folder by id.
    expect(await getOwnedFolder("a1", "bob")).toBeNull()
  })

  it("renames a folder in place", async () => {
    await seedUsers()
    const { createFolder, renameFolder, getFolder } = await import("./folders")

    await createFolder({ id: "f1", name: "Designs", ownerId: "alice" })
    await renameFolder("f1", "Mockups")

    const fetched = await getFolder("f1")
    expect(fetched).toMatchObject({ id: "f1", name: "Mockups" })
  })

  it("stores a nested folder's parent", async () => {
    await seedUsers()
    const { createFolder } = await import("./folders")

    await createFolder({ id: "parent", name: "Parent", ownerId: "alice" })
    const child = await createFolder({
      id: "child",
      name: "Child",
      ownerId: "alice",
      parentFolderId: "parent",
    })
    expect(child.parentFolderId).toBe("parent")
  })
})

// Room placement is the per-user filing of a Room into the tree (PRD #483):
// keyed `(userId, roomId)`, so it upserts to one row per user+Room and stays
// private — filing a shared Room never moves it in another user's view.
describe("lib/folders room placement", () => {
  vi.setConfig({ testTimeout: 30000 })

  beforeEach(() => {
    vi.resetModules()
    delete (globalThis as { __screenplayDbHandle?: unknown })
      .__screenplayDbHandle
    vi.stubEnv("SCREENPLAY_DB", "pglite")
    vi.stubEnv("PGLITE_DATA_DIR", "memory://")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // A placement row's three FKs (user, room, folder) all have to resolve, so
  // seed the whole graph: two users, a shared Room they both own one of, and a
  // folder per user.
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
      { id: "af1", name: "Alice One", ownerId: "alice" },
      { id: "af2", name: "Alice Two", ownerId: "alice" },
      { id: "bf1", name: "Bob One", ownerId: "bob" },
    ])
  }

  it("files a Room into a folder and lists it back", async () => {
    await seedGraph()
    const { placeRoomInFolder, listRoomPlacementsForUser } =
      await import("./folders")

    await placeRoomInFolder({
      userId: "alice",
      roomId: "shared",
      folderId: "af1",
    })

    expect(await listRoomPlacementsForUser("alice")).toEqual([
      { roomId: "shared", folderId: "af1" },
    ])
  })

  it("upserts to a single row per user+Room when re-filed", async () => {
    await seedGraph()
    const { placeRoomInFolder, listRoomPlacementsForUser } =
      await import("./folders")

    await placeRoomInFolder({
      userId: "alice",
      roomId: "shared",
      folderId: "af1",
    })
    // Re-filing the same Room moves it rather than stacking a second row.
    await placeRoomInFolder({
      userId: "alice",
      roomId: "shared",
      folderId: "af2",
    })

    expect(await listRoomPlacementsForUser("alice")).toEqual([
      { roomId: "shared", folderId: "af2" },
    ])
  })

  it("drops a Room back to root by clearing its placement", async () => {
    await seedGraph()
    const { placeRoomInFolder, listRoomPlacementsForUser } =
      await import("./folders")

    await placeRoomInFolder({
      userId: "alice",
      roomId: "shared",
      folderId: "af1",
    })
    // Null target = the user's root, which is modeled by the absence of a row.
    await placeRoomInFolder({
      userId: "alice",
      roomId: "shared",
      folderId: null,
    })

    expect(await listRoomPlacementsForUser("alice")).toEqual([])
  })

  it("keeps placement per-user: filing a shared Room is invisible to others", async () => {
    await seedGraph()
    const { placeRoomInFolder, listRoomPlacementsForUser } =
      await import("./folders")

    // Alice files the shared Room; Bob files the same Room into his own folder.
    await placeRoomInFolder({
      userId: "alice",
      roomId: "shared",
      folderId: "af1",
    })
    await placeRoomInFolder({
      userId: "bob",
      roomId: "shared",
      folderId: "bf1",
    })

    // Each user sees only their own filing — Bob's placement never appears for
    // Alice, and vice versa.
    expect(await listRoomPlacementsForUser("alice")).toEqual([
      { roomId: "shared", folderId: "af1" },
    ])
    expect(await listRoomPlacementsForUser("bob")).toEqual([
      { roomId: "shared", folderId: "bf1" },
    ])
  })
})
