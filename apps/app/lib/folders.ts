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
