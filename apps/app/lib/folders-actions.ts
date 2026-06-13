"use server"

import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import {
  createFolder as createFolderRecord,
  getOwnedFolder,
  listFoldersForUser,
  listRoomPlacementsForUser,
  placeRoomInFolder,
  renameFolder as renameFolderRecord,
} from "@/lib/folders"

// Server actions over folders, mirroring `lib/rooms-actions`. Every action gates
// on `requireUserId` and scopes to that user, so folders stay private per user
// (PRD #475). Works unchanged on the local build, where `requireUserId` resolves
// to the single seeded local user.

export type FolderSummary = {
  id: string
  name: string
  ownerId: string
  parentFolderId: string | null
  createdAt: number
  updatedAt: number
}

function toSummary(folder: {
  id: string
  name: string
  ownerId: string
  parentFolderId: string | null
  createdAt: number
  updatedAt: number
}): FolderSummary {
  return {
    id: folder.id,
    name: folder.name,
    ownerId: folder.ownerId,
    parentFolderId: folder.parentFolderId,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  }
}

export async function createFolder(
  name: string,
  parentFolderId: string | null = null
): Promise<FolderSummary> {
  const ownerId = await requireUserId()
  const trimmed = name.trim() || "Untitled folder"
  const id = nanoid(10)

  const folder = await createFolderRecord({
    id,
    name: trimmed,
    ownerId,
    parentFolderId,
  })
  return toSummary(folder)
}

export async function renameFolder(
  folderId: string,
  name: string
): Promise<void> {
  const ownerId = await requireUserId()
  // Owner-scoped lookup gates the rename: a folder the caller doesn't own reads
  // as not found, so one user can never rename another's folder (PRD #475).
  const folder = await getOwnedFolder(folderId, ownerId)
  if (!folder) throw new Error("Folder not found")
  const trimmed = name.trim() || "Untitled folder"
  await renameFolderRecord(folderId, trimmed)
}

export async function listFolders(): Promise<FolderSummary[]> {
  const ownerId = await requireUserId()
  const folders = await listFoldersForUser(ownerId)
  return folders.map(toSummary)
}

// Where the current user has filed each of their Rooms — a `(roomId, folderId)`
// list, with Rooms at the user's root simply absent (PRD #475).
export type RoomPlacementSummary = {
  roomId: string
  folderId: string
}

export async function listRoomPlacements(): Promise<RoomPlacementSummary[]> {
  const userId = await requireUserId()
  return listRoomPlacementsForUser(userId)
}

// File `roomId` under `folderId` for the current user, or drop it back to their
// root when `folderId` is null. Placement is per-user, so this never changes
// where a collaborator sees the same Room. A non-null target must be a folder
// the caller owns, so a stray call can't file a Room under another user's (or a
// nonexistent) folder.
export async function placeRoom(
  roomId: string,
  folderId: string | null
): Promise<void> {
  const userId = await requireUserId()
  if (folderId !== null) {
    const owned = await getOwnedFolder(folderId, userId)
    if (!owned) throw new Error("Folder not found")
  }
  await placeRoomInFolder({ userId, roomId, folderId })
}
