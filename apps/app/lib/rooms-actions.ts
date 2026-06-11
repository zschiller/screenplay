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
  getRoom,
  listMembers,
  listRoomsForUser,
  removeMember,
  renameRoom as renameRoomRecord,
  requireMember,
  requireOwner,
} from "@/lib/rooms"
import { deleteSandboxes } from "@/lib/sandbox/lifecycle"
import { killTerminalSessions } from "@/lib/sandbox/terminal"
import { listTerminalTabs } from "@/lib/terminal-tabs"
import { yjsHost } from "@/lib/yjs-host"
import { readRoomDoc } from "@/lib/yjs/server"
import { isLocalBuild } from "@/lib/local-mode"

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
  createdAt: number
  lastConnectionAt: number | null
  thumbnailUrl: string | null
  thumbnailUpdatedAt: number | null
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
    createdAt: room.createdAt,
    lastConnectionAt: room.lastOpenedAt,
    thumbnailUrl: room.thumbnailUrl,
    thumbnailUpdatedAt: room.thumbnailUpdatedAt,
  }
}

export async function listRooms(): Promise<RoomSummary[]> {
  const userId = await requireUserId()
  const rooms = await listRoomsForUser(userId)
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    isOwner: room.ownerId === userId,
    createdAt: room.createdAt,
    lastConnectionAt: room.lastOpenedAt,
    thumbnailUrl: room.thumbnailUrl,
    thumbnailUpdatedAt: room.thumbnailUpdatedAt,
  }))
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
  await requireOwner(roomId, userId)

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
