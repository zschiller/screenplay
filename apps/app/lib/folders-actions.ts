"use server"

import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import { canMoveFolder } from "@/lib/folder-tree"
import {
  createFolder as createFolderRecord,
  deleteFolder as deleteFolderRecord,
  getOwnedFolder,
  listFoldersForUser,
  listRoomPlacementsForUser,
  placeRoomInFolder,
  renameFolder as renameFolderRecord,
  updateFolderParent,
} from "@/lib/folders"
import {
  collectFolderCascade,
  descendantFolderIds,
  type CascadeRoom,
} from "@/lib/folder-cascade"
import { decideRoomDeletion } from "@/lib/room-deletion"
import { leaveRoom, teardownRoom } from "@/lib/room-teardown"
import { getRoom, listMembers } from "@/lib/rooms"
import { isLocalBuild } from "@/lib/local-mode"

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

// Re-parent `folderId` under `parentFolderId` (null = the "All files" root) for
// the current user. Both the folder and a non-null destination must be folders
// the caller owns, so a stray call can't move another user's folder or file one
// under a folder they can't see. The cycle guard (`lib/folder-tree`) rejects a
// move into the folder itself or any of its descendants, which would orphan a
// loop out of the tree — the same check the picker uses to disable those
// targets, enforced here so it holds even if the client is bypassed.
export async function moveFolder(
  folderId: string,
  parentFolderId: string | null
): Promise<void> {
  const ownerId = await requireUserId()
  const folder = await getOwnedFolder(folderId, ownerId)
  if (!folder) throw new Error("Folder not found")
  if (parentFolderId !== null) {
    const target = await getOwnedFolder(parentFolderId, ownerId)
    if (!target) throw new Error("Folder not found")
  }
  const folders = await listFoldersForUser(ownerId)
  if (!canMoveFolder(folders, folderId, parentFolderId)) {
    throw new Error("Cannot move a folder into itself or one of its subfolders")
  }
  await updateFolderParent(folderId, parentFolderId)
}

export async function listFolders(): Promise<FolderSummary[]> {
  const ownerId = await requireUserId()
  const folders = await listFoldersForUser(ownerId)
  return folders.map(toSummary)
}

// What deleting a folder will entail, for the caller's local state cleanup: the
// folder subtree removed and the Rooms torn down or left. The confirm's counts
// are derived client-side from the same pure collector, so this returns the ids
// the UI prunes rather than re-reporting the totals.
export type FolderDeletionResult = {
  /** Every Folder removed — the target plus its descendants, any depth. */
  folderIds: string[]
  /** Owned Rooms permanently torn down. */
  teardownRoomIds: string[]
  /** Shared Rooms the caller left (untouched for everyone else). */
  leaveRoomIds: string[]
}

/**
 * Delete a folder and everything beneath it (PRD #475, #488). The folder and all
 * sub-folders (any depth) are removed, and each contained Room is resolved by
 * the **one** Room-deletion rule the single-Room ⋮ delete uses: solely-owned →
 * hard delete; shared non-owned → the caller leaves. The pure
 * {@link collectFolderCascade} enumerates the branch from a DB snapshot — never
 * the client — so a stray call can't tear down Rooms outside the caller's tree.
 * On the local build there is no sharing, so this is always a clean recursive
 * delete.
 */
export async function deleteFolder(
  folderId: string
): Promise<FolderDeletionResult> {
  const ownerId = await requireUserId()
  // Owner-scoped lookup gates the delete: a folder the caller doesn't own reads
  // as not found, so one user can never delete another's tree (PRD #475).
  const folder = await getOwnedFolder(folderId, ownerId)
  if (!folder) throw new Error("Folder not found")

  const folders = await listFoldersForUser(ownerId)
  const branch = new Set(descendantFolderIds(folderId, folders))

  // Only the caller's placements that fall inside the branch can be affected;
  // resolve each placed Room's membership to the facts the cascade decides from.
  const placements = await listRoomPlacementsForUser(ownerId)
  const cascadeRooms: CascadeRoom[] = []
  for (const placement of placements) {
    if (!branch.has(placement.folderId)) continue
    const room = await getRoom(placement.roomId)
    // A placement to a Room that no longer exists just cascades away with the
    // folder — nothing to tear down.
    if (!room) continue
    // The local build has no `room_member` table: the caller is the sole member
    // and every Room is a clean hard delete (PRD #404, issue #417).
    const memberIds = isLocalBuild
      ? [ownerId]
      : (await listMembers(placement.roomId)).map((m) => m.userId)
    const decision = decideRoomDeletion({
      deleterId: ownerId,
      ownerId: room.ownerId,
      memberIds,
    })
    cascadeRooms.push({
      roomId: placement.roomId,
      folderId: placement.folderId,
      isOwner: decision.isOwner,
      sharedWithCount: decision.sharedWithCount,
    })
  }

  const cascade = collectFolderCascade(folderId, folders, cascadeRooms)

  // Apply the same per-Room outcome as the single-Room delete, then remove the
  // folder subtree. Sub-folders and any leftover placements cascade away via the
  // self-referencing FK, so the single delete clears the whole branch.
  for (const roomId of cascade.teardownRoomIds) {
    await teardownRoom(roomId, ownerId)
  }
  for (const roomId of cascade.leaveRoomIds) {
    await leaveRoom(roomId, ownerId)
  }
  await deleteFolderRecord(folderId)

  return {
    folderIds: cascade.folderIds,
    teardownRoomIds: cascade.teardownRoomIds,
    leaveRoomIds: cascade.leaveRoomIds,
  }
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
