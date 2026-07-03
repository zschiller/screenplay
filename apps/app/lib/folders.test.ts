import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { setupSharedPgliteDb, type SharedPgliteDb } from "../test/pglite"

// Persistence tests for `lib/folders`, driven against an in-memory PGlite — the
// same plain Postgres the desktop build runs — in the style of the local-build
// db tests. They pin the two load-bearing guarantees: a created folder
// round-trips, and listing is scoped to its owner so one user's tree can never
// surface in another's.

// Boot one in-memory PGlite for the whole file (migrations run once) and route
// the `@/lib/db` seam at it; every test across the describe blocks below starts
// from a truncated clean slate rather than paying a fresh ~2s WASM boot.
// `beforeAll` gets headroom so the one-time boot stays reliable under
// full-suite CPU contention.
let harness: SharedPgliteDb
beforeAll(async () => {
  harness = await setupSharedPgliteDb()
}, 30000)
afterAll(() => harness.close())
beforeEach(() => harness.reset())

describe("lib/folders persistence", () => {
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

  it("re-parents a folder via updateFolderParent", async () => {
    await seedUsers()
    const { createFolder, updateFolderParent, getFolder } =
      await import("./folders")

    await createFolder({ id: "dest", name: "Dest", ownerId: "alice" })
    await createFolder({ id: "moving", name: "Moving", ownerId: "alice" })

    await updateFolderParent("moving", "dest")
    expect((await getFolder("moving"))?.parentFolderId).toBe("dest")

    // Null drops it back to the root.
    await updateFolderParent("moving", null)
    expect((await getFolder("moving"))?.parentFolderId).toBeNull()
  })
})

// Room placement is the per-user filing of a Room into the tree (PRD #483):
// keyed `(userId, roomId)`, so it upserts to one row per user+Room and stays
// private — filing a shared Room never moves it in another user's view.
describe("lib/folders room placement", () => {
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

// The folder cascade's persistence half (#488): deleting a folder removes its
// whole subtree and clears the placements that hung off it, so the branch is
// gone in a single delete. (Tearing down the owned Rooms themselves is the
// server action's job; here we pin the folder + placement cascade the FK gives.)
describe("lib/folders cascade delete", () => {
  // A nested tree with Rooms filed at two depths, plus an unrelated sibling
  // branch the delete must leave alone.
  //   parent ── child            other
  async function seedTree() {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db
      .insert(schema.user)
      .values([{ id: "alice", name: "Alice", email: "alice@example.com" }])
    await db.insert(schema.room).values([
      { id: "r-parent", name: "In Parent", ownerId: "alice" },
      { id: "r-child", name: "In Child", ownerId: "alice" },
      { id: "r-other", name: "Elsewhere", ownerId: "alice" },
    ])
    await db.insert(schema.folder).values([
      { id: "parent", name: "Parent", ownerId: "alice" },
      {
        id: "child",
        name: "Child",
        ownerId: "alice",
        parentFolderId: "parent",
      },
      { id: "other", name: "Other", ownerId: "alice" },
    ])
  }

  it("removes the folder, its sub-folders, and their placements", async () => {
    await seedTree()
    const {
      deleteFolder,
      listFoldersForUser,
      placeRoomInFolder,
      listRoomPlacementsForUser,
    } = await import("./folders")

    await placeRoomInFolder({
      userId: "alice",
      roomId: "r-parent",
      folderId: "parent",
    })
    await placeRoomInFolder({
      userId: "alice",
      roomId: "r-child",
      folderId: "child",
    })
    await placeRoomInFolder({
      userId: "alice",
      roomId: "r-other",
      folderId: "other",
    })

    await deleteFolder("parent")

    // The parent and its child folder are both gone; the sibling survives.
    expect((await listFoldersForUser("alice")).map((f) => f.id)).toEqual([
      "other",
    ])
    // Placements under the deleted branch cascaded away; the unrelated one
    // remains.
    expect(await listRoomPlacementsForUser("alice")).toEqual([
      { roomId: "r-other", folderId: "other" },
    ])
  })
})
