import "server-only"

import { and, asc, eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"

// Server-only CRUD over the `folder` table, mirroring `lib/rooms`. Folders are
// per-user (PRD #475): every query is scoped by `ownerId`, so one user's tree is
// invisible to another. The `folder` table lives in the core schema half, so
// this works unchanged on the local PGlite (desktop) build — there the single
// seeded local user owns the whole tree.

export type FolderRecord = {
  id: string
  ownerId: string
  parentFolderId: string | null
  name: string
  createdAt: number
  updatedAt: number
}

// Where a user files a Room in their tree. The absence of a placement for a
// (user, Room) pair means the Room sits at that user's root, so this only ever
// carries Rooms a user has actively filed into a folder.
export type RoomPlacement = {
  roomId: string
  folderId: string
}

function toFolder(row: typeof schema.folder.$inferSelect): FolderRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    parentFolderId: row.parentFolderId,
    name: row.name,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

export async function createFolder(opts: {
  id: string
  name: string
  ownerId: string
  parentFolderId?: string | null
}): Promise<FolderRecord> {
  const [row] = await db
    .insert(schema.folder)
    .values({
      id: opts.id,
      name: opts.name,
      ownerId: opts.ownerId,
      parentFolderId: opts.parentFolderId ?? null,
    })
    .returning()
  if (!row) throw new Error("Failed to create folder")
  return toFolder(row)
}

export async function getFolder(
  folderId: string
): Promise<FolderRecord | null> {
  const rows = await db
    .select()
    .from(schema.folder)
    .where(eq(schema.folder.id, folderId))
    .limit(1)
  return rows[0] ? toFolder(rows[0]) : null
}

// Every folder the user owns, across all depths. The caller (the home provider /
// `lib/folder-tree`) partitions by `parentFolderId` and sorts within each level,
// so persistence stays a flat owner-scoped fetch. Ordered by creation as a
// stable baseline; the active sort key is applied in the pure layer.
export async function listFoldersForUser(
  ownerId: string
): Promise<FolderRecord[]> {
  const rows = await db
    .select()
    .from(schema.folder)
    .where(eq(schema.folder.ownerId, ownerId))
    .orderBy(asc(schema.folder.createdAt))
  return rows.map(toFolder)
}

export async function renameFolder(
  folderId: string,
  name: string
): Promise<void> {
  await db
    .update(schema.folder)
    .set({ name, updatedAt: new Date() })
    .where(eq(schema.folder.id, folderId))
}

// Re-parent a folder under `parentFolderId` (null = the "All files" root). The
// caller (the `moveFolder` action) owns the cycle guard and the owner checks;
// this is the bare write. Bumps `updatedAt` so the moved folder re-sorts under
// the "Last edited" key, matching rename.
export async function updateFolderParent(
  folderId: string,
  parentFolderId: string | null
): Promise<void> {
  await db
    .update(schema.folder)
    .set({ parentFolderId, updatedAt: new Date() })
    .where(eq(schema.folder.id, folderId))
}

export async function deleteFolder(folderId: string): Promise<void> {
  // Sub-folders cascade via the self-referencing FK's ON DELETE CASCADE.
  await db.delete(schema.folder).where(eq(schema.folder.id, folderId))
}

// Owner-scoped lookup — used by mutations to verify the caller owns the folder
// before touching it, so one user can never rename/delete another's folder.
export async function getOwnedFolder(
  folderId: string,
  ownerId: string
): Promise<FolderRecord | null> {
  const rows = await db
    .select()
    .from(schema.folder)
    .where(
      and(eq(schema.folder.id, folderId), eq(schema.folder.ownerId, ownerId))
    )
    .limit(1)
  return rows[0] ? toFolder(rows[0]) : null
}

// --- Room placement within the tree (per-user) -----------------------------
//
// Placement is keyed `(userId, roomId)`, so it is private: filing a shared Room
// moves it only in that user's view. "At root for this user" is modeled by the
// *absence* of a row, which keeps the table holding only active filings and lets
// `null` mean root everywhere in the pure layer.

// File `roomId` under `folderId` for `userId`, or drop it back to the user's
// root when `folderId` is null. Upserts on the `(userId, roomId)` PK, so each
// user has at most one placement per Room — re-filing overwrites rather than
// stacking rows.
export async function placeRoomInFolder(opts: {
  userId: string
  roomId: string
  folderId: string | null
}): Promise<void> {
  if (opts.folderId === null) {
    // Root is the no-row state: clear any existing filing for this user+Room.
    await db
      .delete(schema.roomFolder)
      .where(
        and(
          eq(schema.roomFolder.userId, opts.userId),
          eq(schema.roomFolder.roomId, opts.roomId)
        )
      )
    return
  }
  await db
    .insert(schema.roomFolder)
    .values({
      userId: opts.userId,
      roomId: opts.roomId,
      folderId: opts.folderId,
    })
    .onConflictDoUpdate({
      target: [schema.roomFolder.userId, schema.roomFolder.roomId],
      set: { folderId: opts.folderId, updatedAt: new Date() },
    })
}

// The folder this user has filed `roomId` into, or null when the Room sits at
// the user's root (no placement row). Joins through `roomFolder` so the canvas
// breadcrumb can point its parent crumb at the Room's actual home (PRD #475);
// per-user, so a collaborator who filed the same Room elsewhere sees their own.
export async function getRoomParentFolderForUser(
  userId: string,
  roomId: string
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: schema.folder.id, name: schema.folder.name })
    .from(schema.roomFolder)
    .innerJoin(schema.folder, eq(schema.folder.id, schema.roomFolder.folderId))
    .where(
      and(
        eq(schema.roomFolder.userId, userId),
        eq(schema.roomFolder.roomId, roomId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

// Every Room this user has filed into a folder, as a flat `(roomId, folderId)`
// list. Rooms with no row are at the user's root; the caller (home provider /
// `lib/folder-tree`) treats a missing entry as `folderId: null`.
export async function listRoomPlacementsForUser(
  userId: string
): Promise<RoomPlacement[]> {
  const rows = await db
    .select({
      roomId: schema.roomFolder.roomId,
      folderId: schema.roomFolder.folderId,
    })
    .from(schema.roomFolder)
    .where(eq(schema.roomFolder.userId, userId))
  return rows.map((r) => ({ roomId: r.roomId, folderId: r.folderId }))
}
