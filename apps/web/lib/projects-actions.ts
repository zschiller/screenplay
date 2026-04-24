"use server"

import { nanoid } from "nanoid"
import {
  getUserByEmail,
  getUsersByIds,
  requireUserId,
} from "@/lib/auth-server"
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

function parseName(metadata: Record<string, string | string[]>): string {
  const raw = metadata.name
  if (typeof raw === "string" && raw.length) return raw
  return "Untitled"
}

function parseOwnerId(metadata: Record<string, string | string[]>): string {
  const raw = metadata.ownerId
  if (typeof raw === "string") return raw
  return ""
}

export async function createProject(
  name: string,
): Promise<ProjectSummary> {
  const userId = await requireUserId()
  const trimmed = name.trim() || "Untitled"
  const id = nanoid(10)

  const room = await liveblocks.createRoom(id, {
    defaultAccesses: [],
    usersAccesses: {
      [userId]: ["room:write"],
    },
    metadata: {
      name: trimmed,
      ownerId: userId,
    },
  })

  // Initialize storage server-side to mirror the RoomProvider's initialStorage.
  // Without this, the first client mutation races against Liveblocks' lazy
  // storage init and the request is rejected with 400.
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
    name: trimmed,
    ownerId: userId,
    isOwner: true,
    createdAt: room.createdAt.getTime(),
    lastConnectionAt: room.lastConnectionAt?.getTime() ?? null,
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const userId = await requireUserId()
  const projects: ProjectSummary[] = []

  for await (const room of liveblocks.iterRooms({ userId })) {
    const ownerId = parseOwnerId(room.metadata)
    projects.push({
      id: room.id,
      name: parseName(room.metadata),
      ownerId,
      isOwner: ownerId === userId,
      createdAt: room.createdAt.getTime(),
      lastConnectionAt: room.lastConnectionAt?.getTime() ?? null,
    })
  }

  projects.sort((a, b) => b.createdAt - a.createdAt)
  return projects
}

async function requireOwner(roomId: string, userId: string) {
  const room = await liveblocks.getRoom(roomId)
  if (parseOwnerId(room.metadata) !== userId) {
    throw new Error("Only the project owner can do this")
  }
  return room
}

export async function renameProject(
  roomId: string,
  name: string,
): Promise<void> {
  const userId = await requireUserId()
  await requireOwner(roomId, userId)
  const trimmed = name.trim() || "Untitled"
  await liveblocks.updateRoom(roomId, {
    metadata: { name: trimmed },
  })
}

export async function deleteProject(roomId: string): Promise<void> {
  const userId = await requireUserId()
  await requireOwner(roomId, userId)
  await liveblocks.deleteRoom(roomId)
}

export async function listCollaborators(
  roomId: string,
): Promise<CollaboratorInfo[]> {
  const userId = await requireUserId()
  const room = await liveblocks.getRoom(roomId)
  if (!room.usersAccesses[userId]) {
    throw new Error("You don't have access to this project")
  }

  const ownerId = parseOwnerId(room.metadata)
  const userIds = Object.keys(room.usersAccesses)
  if (!userIds.length) return []

  const users = await getUsersByIds(userIds)

  return userIds.map((id) => {
    const user = users.find((u) => u.id === id)
    const name = user?.name?.trim() || user?.email || "Unknown"
    return {
      userId: id,
      name,
      email: user?.email ?? null,
      avatar: user?.image ?? null,
      isOwner: id === ownerId,
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

  await liveblocks.updateRoom(roomId, {
    usersAccesses: {
      [invitee.id]: ["room:write"],
    },
  })

  return listCollaborators(roomId)
}

export async function removeCollaborator(
  roomId: string,
  collaboratorId: string,
): Promise<CollaboratorInfo[]> {
  const userId = await requireUserId()
  const room = await requireOwner(roomId, userId)
  if (parseOwnerId(room.metadata) === collaboratorId) {
    throw new Error("Cannot remove the project owner")
  }

  await liveblocks.updateRoom(roomId, {
    usersAccesses: {
      [collaboratorId]: null,
    },
  })

  return listCollaborators(roomId)
}
