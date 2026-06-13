"use server"

import { nanoid } from "nanoid"
import {
  getUserByEmail,
  getUsersByIds,
  requireUserId,
} from "@/lib/auth-helpers"
import {
  addMember,
  createRoom as createRoomRecord,
  deleteRoom as deleteRoomRecord,
  getMemberCounts,
  getRoom,
  listMembers,
  listRoomThumbnailsForUser,
  listRoomsForUser,
  removeMember,
  renameRoom as renameRoomRecord,
  requireMember,
  requireOwner,
} from "@/lib/rooms"
import { decideRoomDeletion } from "@/lib/room-deletion"
import { deleteSandboxes } from "@/lib/sandbox/lifecycle"
import { killTerminalSessions } from "@/lib/sandbox/terminal"
import { listTerminalTabs } from "@/lib/terminal-tabs"
import { yjsHost } from "@/lib/yjs-host"
import { readRoomDoc } from "@/lib/yjs/server"
import { isLocalBuild } from "@/lib/local-mode"
import type { ThumbnailManifest } from "@/lib/thumbnail/manifest"
import type { RoomThumbnail } from "@/lib/room-thumbnail-merge"

// Sharing is excluded from the local desktop build (PRD #404, issue #417):
// there is one local user and no `room_member` table. The UI affordances are
// hidden, and these actions refuse as a backstop so a stray client call can't
// hit a table that doesn't exist.
function assertNotLocal(): void {
  if (isLocalBuild) {
    throw new Error("Sharing is not available in the local build")
  }
}

export type RoomSummary = {
  id: string
  name: string
  ownerId: string
  isOwner: boolean
  /**
   * How many *other* people the Room is shared with — what the delete confirm
   * names ("shared with N people"). Always 0 on the local build (no sharing).
   */
  sharedWithCount: number
  createdAt: number
  lastConnectionAt: number | null
  thumbnailUrl: string | null
  thumbnailUpdatedAt: number | null
  thumbnailManifest: ThumbnailManifest | null
}

export type CollaboratorInfo = {
  userId: string
  name: string
  email: string | null
  avatar: string | null
  isOwner: boolean
}

export async function createRoom(name: string): Promise<RoomSummary> {
  const userId = await requireUserId()
  const trimmed = name.trim() || "Untitled"
  const id = nanoid(10)

  const room = await createRoomRecord({ id, name: trimmed, ownerId: userId })

  await yjsHost.ensureRoom({ roomId: id, ownerId: userId, name: trimmed })

  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    isOwner: true,
    // A just-created Room has only its owner — nobody to share-delete for yet.
    sharedWithCount: 0,
    createdAt: room.createdAt,
    lastConnectionAt: room.lastOpenedAt,
    thumbnailUrl: room.thumbnailUrl,
    thumbnailUpdatedAt: room.thumbnailUpdatedAt,
    thumbnailManifest: room.thumbnailManifest,
  }
}

export async function listRooms(): Promise<RoomSummary[]> {
  const userId = await requireUserId()
  const rooms = await listRoomsForUser(userId)
  // Member counts feed the shared-aware delete confirm. The local build has no
  // `room_member` table and no sharing, so skip the query and report 0 for
  // every Room (PRD #404, issue #417).
  const counts = isLocalBuild
    ? new Map<string, number>()
    : await getMemberCounts(rooms.map((r) => r.id))
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    isOwner: room.ownerId === userId,
    // Total members minus the viewer themselves; never negative.
    sharedWithCount: Math.max(0, (counts.get(room.id) ?? 1) - 1),
    createdAt: room.createdAt,
    lastConnectionAt: room.lastOpenedAt,
    thumbnailUrl: room.thumbnailUrl,
    thumbnailUpdatedAt: room.thumbnailUpdatedAt,
    thumbnailManifest: room.thumbnailManifest,
  }))
}

/**
 * The thumbnail slice of the user's rooms, for the homescreen's live-refresh
 * poll. Reads only the per-Room record (manifest + capture time), never a
 * Room's Y.Doc, so an open grid reflects a fresh capture round without a full
 * page reload.
 */
export async function listRoomThumbnails(): Promise<RoomThumbnail[]> {
  const userId = await requireUserId()
  return listRoomThumbnailsForUser(userId)
}

export async function renameRoom(roomId: string, name: string): Promise<void> {
  const userId = await requireUserId()
  await requireOwner(roomId, userId)
  const trimmed = name.trim() || "Untitled"
  await renameRoomRecord(roomId, trimmed)
  await yjsHost.updateRoomMetadata(roomId, { name: trimmed })
}

export async function deleteRoom(roomId: string): Promise<void> {
  const userId = await requireUserId()

  const room = await getRoom(roomId)
  if (!room) throw new Error("Project not found")
  // A non-member can neither delete nor leave a Room they can't see.
  await requireMember(roomId, userId)

  // Route every delete through the one Room-deletion rule. The local build has
  // no `room_member` table and a single user, so the deleter is always the
  // sole member — the clean hard-delete path (PRD #404, issue #417).
  const memberIds = isLocalBuild
    ? [userId]
    : (await listMembers(roomId)).map((m) => m.userId)
  const decision = decideRoomDeletion({
    deleterId: userId,
    ownerId: room.ownerId,
    memberIds,
  })

  if (decision.action === "leave") {
    // Shared non-owner: drop only the deleter's membership (their per-user
    // folder placement will go too, once placements exist — folder slice,
    // #475). The Room — its Sandboxes, Y.Doc and rows — is untouched for
    // everyone else, so resync the remaining members on the host.
    await removeMember(roomId, userId)
    const remaining = await listMembers(roomId)
    await yjsHost.syncRoomMembers(
      roomId,
      remaining.map((m) => ({ userId: m.userId, role: m.role }))
    )
    return
  }

  // hard-delete (sole member) or delete-for-all (shared owner): identical
  // teardown — the Room is gone for everyone who could see it.
  await teardownRoom(roomId, userId)
}

/**
 * Tear a Room down completely: its rows, Y.Doc, live terminal sessions, and
 * every Branch's Sandbox. Shared by the sole-member hard delete and the owner's
 * delete-for-all — both destroy the Room for everyone who could see it.
 */
async function teardownRoom(roomId: string, userId: string): Promise<void> {
  // Capture what the Room owns *before* its Y.Doc and rows are gone: the
  // Branches' Sandbox names from the authoritative doc — enumerated
  // server-side, never accepted from the client, so a forged list can't
  // delete Sandboxes the caller doesn't own — and the caller's terminal tabs
  // (their rows cascade away with the room record). Best-effort: an
  // unreadable doc must not block the delete itself.
  let sandboxNames: string[] = []
  try {
    sandboxNames = await readRoomDoc(roomId, (c) =>
      c.branches
        .toArray()
        .map((b) => b.sandboxName)
        .filter(Boolean)
    )
  } catch {}
  let terminalSessionIds: string[] = []
  try {
    terminalSessionIds = (await listTerminalTabs({ userId, roomId })).map(
      (t) => t.id
    )
  } catch {}

  await deleteRoomRecord(roomId)
  await yjsHost.deleteRoom(roomId)

  // With the Room gone, tear down what backed it: live terminal sessions
  // (desktop ptys — hosted tmux dies with its VM) and every Branch's Sandbox,
  // upholding "a Sandbox never outlives its Branch". On desktop this is also
  // what frees each Branch's git ref: a leaked worktree keeps its branch
  // checked out and blocks reopening it anywhere (RefAlreadyOpenError). Both
  // calls are internally best-effort so cleanup can never make the delete
  // appear to fail after the Room is already gone.
  await killTerminalSessions(terminalSessionIds)
  await deleteSandboxes(sandboxNames)
}

export async function listCollaborators(
  roomId: string
): Promise<CollaboratorInfo[]> {
  assertNotLocal()
  const userId = await requireUserId()
  await requireMember(roomId, userId)

  const room = await getRoom(roomId)
  if (!room) return []

  const members = await listMembers(roomId)
  if (!members.length) return []

  const userIds = members.map((m) => m.userId)
  const users = await getUsersByIds(userIds)

  return members.map((m) => {
    const user = users.find((u) => u.id === m.userId)
    return {
      userId: m.userId,
      name: user?.name ?? "Unknown",
      email: user?.email ?? null,
      avatar: user?.image ?? null,
      isOwner: m.userId === room.ownerId,
    }
  })
}

export async function shareRoom(
  roomId: string,
  email: string
): Promise<CollaboratorInfo[]> {
  assertNotLocal()
  const userId = await requireUserId()
  await requireOwner(roomId, userId)

  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error("Email is required")

  const invitee = await getUserByEmail(normalized)
  if (!invitee) {
    throw new Error(`No user found with email "${normalized}"`)
  }

  await addMember({ roomId, userId: invitee.id, role: "editor" })
  const allMembers = await listMembers(roomId)
  await yjsHost.syncRoomMembers(
    roomId,
    allMembers.map((m) => ({ userId: m.userId, role: m.role }))
  )

  return listCollaborators(roomId)
}

export async function removeCollaborator(
  roomId: string,
  collaboratorId: string
): Promise<CollaboratorInfo[]> {
  assertNotLocal()
  const userId = await requireUserId()
  const room = await requireOwner(roomId, userId)
  if (room.ownerId === collaboratorId) {
    throw new Error("Cannot remove the project owner")
  }

  await removeMember(roomId, collaboratorId)
  const allMembers = await listMembers(roomId)
  await yjsHost.syncRoomMembers(
    roomId,
    allMembers.map((m) => ({ userId: m.userId, role: m.role }))
  )

  return listCollaborators(roomId)
}
