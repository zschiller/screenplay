"use server"

import { nanoid } from "nanoid"
import {
  getUserByEmail,
  getUsersByIds,
  requireUserId,
} from "@/lib/auth-helpers"
import {
  addMember,
  createRoom,
  deleteRoom as deleteRoomRecord,
  getRoom,
  listMembers,
  listRoomsForUser,
  removeMember,
  renameRoom,
  requireMember,
  requireOwner,
} from "@/lib/rooms"
import { liveblocks } from "./liveblocks-server"

export type ProjectSummary = {
  id: string
  name: string
  ownerId: string
  isOwner: boolean
  createdAt: number
  lastConnectionAt: number | null
}

export type CollaboratorInfo = {
  userId: string
  name: string
  email: string | null
  avatar: string | null
  isOwner: boolean
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const userId = await requireUserId()
  const trimmed = name.trim() || "Untitled"
  const id = nanoid(10)

  const room = await createRoom({ id, name: trimmed, ownerId: userId })

  // Liveblocks still hosts the Y.Doc and storage. Create the room there too,
  // gated to the owner — additional members are added in shareProject. Storage
  // is initialized server-side so the first client mutation doesn't race the
  // lazy init that otherwise rejects with 400.
  await liveblocks.createRoom(id, {
    defaultAccesses: [],
    usersAccesses: { [userId]: ["room:write"] },
    metadata: { name: trimmed, ownerId: userId },
  })
  await liveblocks.initializeStorageDocument(id, {
    liveblocksType: "LiveObject",
    data: {
      workspaces: { liveblocksType: "LiveMap", data: {} },
      sandboxes: { liveblocksType: "LiveMap", data: {} },
      artboards: { liveblocksType: "LiveMap", data: {} },
      chatSessions: { liveblocksType: "LiveMap", data: {} },
      plans: { liveblocksType: "LiveMap", data: {} },
    },
  })

  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    isOwner: true,
    createdAt: room.createdAt,
    lastConnectionAt: room.lastOpenedAt,
  }
}

/**
 * One-time backfill: import any Liveblocks rooms the user has access to that
 * don't yet have a Postgres record. Runs on listProjects so the migration is
 * transparent — once every active user lists their projects, Liveblocks can be
 * removed as a metadata source.
 */
async function backfillFromLiveblocks(userId: string): Promise<void> {
  for await (const room of liveblocks.iterRooms({ userId })) {
    const existing = await getRoom(room.id)
    if (existing) continue

    const ownerRaw = room.metadata.ownerId
    const ownerId = typeof ownerRaw === "string" && ownerRaw ? ownerRaw : userId
    const nameRaw = room.metadata.name
    const name =
      typeof nameRaw === "string" && nameRaw.length ? nameRaw : "Untitled"

    try {
      await createRoom({ id: room.id, name, ownerId })
    } catch {
      // Owner user may not exist in our DB; skip silently.
      continue
    }

    for (const memberId of Object.keys(room.usersAccesses)) {
      if (memberId === ownerId) continue
      try {
        await addMember({ roomId: room.id, userId: memberId, role: "editor" })
      } catch {
        // Member user not in DB; skip.
      }
    }
  }
}

/**
 * Per-room backfill — used when a user lands on a room URL directly without
 * going through the home page. Idempotent; no-ops if the room already exists.
 * Returns true when the user ends up with access to the room.
 */
export async function ensureRoomBackfilled(
  roomId: string,
  userId: string,
): Promise<boolean> {
  if (await getRoom(roomId)) return true

  let lbRoom
  try {
    lbRoom = await liveblocks.getRoom(roomId)
  } catch {
    return false
  }
  if (!lbRoom.usersAccesses[userId]) return false

  const ownerRaw = lbRoom.metadata.ownerId
  const ownerId = typeof ownerRaw === "string" && ownerRaw ? ownerRaw : userId
  const nameRaw = lbRoom.metadata.name
  const name =
    typeof nameRaw === "string" && nameRaw.length ? nameRaw : "Untitled"

  try {
    await createRoom({ id: roomId, name, ownerId })
  } catch {
    // Owner missing in Postgres — bail.
    return false
  }
  for (const memberId of Object.keys(lbRoom.usersAccesses)) {
    if (memberId === ownerId) continue
    try {
      await addMember({ roomId, userId: memberId, role: "editor" })
    } catch {
      // skip
    }
  }
  return true
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const userId = await requireUserId()
  await backfillFromLiveblocks(userId)
  const rooms = await listRoomsForUser(userId)
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    isOwner: room.ownerId === userId,
    createdAt: room.createdAt,
    lastConnectionAt: room.lastOpenedAt,
  }))
}

export async function renameProject(
  roomId: string,
  name: string,
): Promise<void> {
  const userId = await requireUserId()
  await requireOwner(roomId, userId)
  const trimmed = name.trim() || "Untitled"
  await renameRoom(roomId, trimmed)
  // Keep Liveblocks metadata in sync so existing consumers (e.g. room page
  // fallback) continue to work during the migration.
  await liveblocks.updateRoom(roomId, { metadata: { name: trimmed } })
}

export async function deleteProject(roomId: string): Promise<void> {
  const userId = await requireUserId()
  await requireOwner(roomId, userId)
  await deleteRoomRecord(roomId)
  await liveblocks.deleteRoom(roomId)
}

export async function listCollaborators(
  roomId: string,
): Promise<CollaboratorInfo[]> {
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

export async function shareProject(
  roomId: string,
  email: string,
): Promise<CollaboratorInfo[]> {
  const userId = await requireUserId()
  await requireOwner(roomId, userId)

  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error("Email is required")

  const invitee = await getUserByEmail(normalized)
  if (!invitee) {
    throw new Error(`No user found with email "${normalized}"`)
  }

  await addMember({ roomId, userId: invitee.id, role: "editor" })
  await liveblocks.updateRoom(roomId, {
    usersAccesses: { [invitee.id]: ["room:write"] },
  })

  return listCollaborators(roomId)
}

export async function removeCollaborator(
  roomId: string,
  collaboratorId: string,
): Promise<CollaboratorInfo[]> {
  const userId = await requireUserId()
  const room = await requireOwner(roomId, userId)
  if (room.ownerId === collaboratorId) {
    throw new Error("Cannot remove the project owner")
  }

  await removeMember(roomId, collaboratorId)
  await liveblocks.updateRoom(roomId, {
    usersAccesses: { [collaboratorId]: null },
  })

  return listCollaborators(roomId)
}

/**
 * Used by sandbox webhooks (unauthenticated) to resolve a stable acting user.
 */
export async function getRoomOwnerId(roomId: string): Promise<string | null> {
  const room = await getRoom(roomId)
  return room?.ownerId ?? null
}
