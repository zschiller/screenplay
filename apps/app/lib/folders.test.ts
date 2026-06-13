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
