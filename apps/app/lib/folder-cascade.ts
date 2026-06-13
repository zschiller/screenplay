import { deletionActionFor, type RoomDeletionAction } from "@/lib/room-deletion"

/**
 * The pure cascade collector for deleting a Folder (PRD #475, #488). React-free
 * and DB-free, mirroring `lib/room-deletion` and `lib/folder-tree`: it takes a
 * snapshot of the user's folder tree and Room placements and enumerates exactly
 * what deleting one Folder entails — the descendant Folders to remove (any
 * depth) and, per contained Room, the **same** per-Room outcome the single-Room
 * ⋮ delete uses, decided by the one Room-deletion rule (`deletionActionFor`).
 *
 * Used on both sides of the action: the home provider runs it over its
 * in-memory snapshot to drive the delete confirm's counts, and the server
 * re-derives it from the DB to perform the teardown — same inputs, same outcome
 * whether a Room is deleted via its own menu or its folder.
 */

/** A Folder reduced to what the cascade walks: its identity and its parent. */
export type CascadeFolder = {
  id: string
  parentFolderId: string | null
}

/**
 * A Room placed somewhere in the tree, carrying the two facts the deletion rule
 * turns on. `folderId` is the Folder the user filed it under (a placement always
 * has one — Rooms at the user's root have no placement and never reach here).
 * `isOwner`/`sharedWithCount` line up with `RoomSummary`, so the provider can
 * pass its rooms straight through.
 */
export type CascadeRoom = {
  roomId: string
  folderId: string
  isOwner: boolean
  sharedWithCount: number
}

export type FolderCascade = {
  /** The target Folder plus every descendant, any depth — all to be deleted. */
  folderIds: string[]
  /**
   * Owned Rooms in the branch to fully tear down (sole-owner hard delete or
   * shared-owner delete-for-all) — the canvases permanently deleted.
   */
  teardownRoomIds: string[]
  /**
   * Shared Rooms in the branch the user doesn't own: they simply leave, and the
   * Room stays intact for its owner and other collaborators.
   */
  leaveRoomIds: string[]
  /** How many canvases are permanently deleted — `teardownRoomIds.length`. */
  deletedCount: number
  /**
   * Owned *shared* Rooms in the branch — each deleted for everyone it's shared
   * with. Drives the confirm's shared-aware line; always 0 on the local build.
   */
  sharedOwnedCount: number
  /** Total *other* people across those owned shared Rooms — the "N people". */
  sharedWithCount: number
}

/**
 * The target Folder plus every descendant, in breadth-first order. Walks the
 * `parentFolderId` tree downward and guards against a corrupt parent cycle with
 * a visited set, so a malformed tree yields a finite set rather than looping.
 * The target is always included even if it isn't in `folders` (it is still the
 * Folder being deleted).
 */
export function descendantFolderIds(
  folderId: string,
  folders: readonly CascadeFolder[]
): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const folder of folders) {
    if (folder.parentFolderId === null) continue
    const siblings = childrenByParent.get(folder.parentFolderId) ?? []
    siblings.push(folder.id)
    childrenByParent.set(folder.parentFolderId, siblings)
  }

  const ids: string[] = []
  const seen = new Set<string>()
  const queue: string[] = [folderId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    for (const child of childrenByParent.get(id) ?? []) {
      if (!seen.has(child)) queue.push(child)
    }
  }
  return ids
}

/**
 * Enumerate the full cascade for deleting `folderId`: the descendant Folders to
 * remove and, for every Room placed anywhere in that branch, the per-Room
 * outcome (teardown vs leave) from the shared deletion rule.
 */
export function collectFolderCascade(
  folderId: string,
  folders: readonly CascadeFolder[],
  rooms: readonly CascadeRoom[]
): FolderCascade {
  const folderIds = descendantFolderIds(folderId, folders)
  const inBranch = new Set(folderIds)

  const teardownRoomIds: string[] = []
  const leaveRoomIds: string[] = []
  let sharedOwnedCount = 0
  let sharedWithCount = 0

  for (const room of rooms) {
    if (!inBranch.has(room.folderId)) continue
    const action: RoomDeletionAction = deletionActionFor(
      room.isOwner,
      room.sharedWithCount
    )
    if (action === "leave") {
      leaveRoomIds.push(room.roomId)
      continue
    }
    // hard-delete (sole member) or delete-for-all (shared owner): full teardown.
    teardownRoomIds.push(room.roomId)
    if (action === "delete-for-all") {
      sharedOwnedCount += 1
      sharedWithCount += room.sharedWithCount
    }
  }

  return {
    folderIds,
    teardownRoomIds,
    leaveRoomIds,
    deletedCount: teardownRoomIds.length,
    sharedOwnedCount,
    sharedWithCount,
  }
}
