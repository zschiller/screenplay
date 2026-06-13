import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import type { RoomRole } from "@/lib/db/schema"
import { isLocalBuild } from "@/lib/local-mode"
import type { ThumbnailManifest } from "@/lib/thumbnail/manifest"

export type { RoomRole }

export type RoomRecord = {
  id: string
  name: string
  ownerId: string
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
  thumbnailUrl: string | null
  thumbnailUpdatedAt: number | null
  thumbnailManifest: ThumbnailManifest | null
}

export type RoomMemberRecord = {
  roomId: string
  userId: string
  role: RoomRole
  createdAt: number
}

function toRoom(row: typeof schema.room.$inferSelect): RoomRecord {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    lastOpenedAt: row.lastOpenedAt?.getTime() ?? null,
    thumbnailUrl: row.thumbnailUrl,
    thumbnailUpdatedAt: row.thumbnailUpdatedAt?.getTime() ?? null,
    thumbnailManifest: row.thumbnailManifest ?? null,
  }
}

export async function createRoom(opts: {
  id: string
  name: string
  ownerId: string
}): Promise<RoomRecord> {
  const [row] = await db
    .insert(schema.room)
    .values({ id: opts.id, name: opts.name, ownerId: opts.ownerId })
    .returning()
  if (!row) throw new Error("Failed to create room")
  // No `room_member` table in the local build — the single local user owns
  // every room implicitly (PRD #404, issue #417).
  if (!isLocalBuild) {
    await db
      .insert(schema.roomMember)
      .values({ roomId: row.id, userId: opts.ownerId, role: "owner" })
      .onConflictDoNothing()
  }
  return toRoom(row)
}

export async function getRoom(roomId: string): Promise<RoomRecord | null> {
  const rows = await db
    .select()
    .from(schema.room)
    .where(eq(schema.room.id, roomId))
    .limit(1)
  return rows[0] ? toRoom(rows[0]) : null
}

export async function listRoomsForUser(userId: string): Promise<RoomRecord[]> {
  // The local build has no `room_member` table to join: the single local user
  // owns every room, so list them all (PRD #404, issue #417).
  if (isLocalBuild) {
    const rows = await db
      .select()
      .from(schema.room)
      .orderBy(desc(schema.room.createdAt))
    return rows.map(toRoom)
  }
  const rows = await db
    .select({
      id: schema.room.id,
      name: schema.room.name,
      ownerId: schema.room.ownerId,
      createdAt: schema.room.createdAt,
      updatedAt: schema.room.updatedAt,
      lastOpenedAt: schema.room.lastOpenedAt,
      thumbnailUrl: schema.room.thumbnailUrl,
      thumbnailUpdatedAt: schema.room.thumbnailUpdatedAt,
      thumbnailManifest: schema.room.thumbnailManifest,
    })
    .from(schema.room)
    .innerJoin(schema.roomMember, eq(schema.roomMember.roomId, schema.room.id))
    .where(eq(schema.roomMember.userId, userId))
    .orderBy(desc(schema.room.createdAt))
  return rows.map(toRoom)
}

export async function renameRoom(roomId: string, name: string): Promise<void> {
  await db
    .update(schema.room)
    .set({ name, updatedAt: new Date() })
    .where(eq(schema.room.id, roomId))
}

export async function deleteRoom(roomId: string): Promise<void> {
  await db.delete(schema.room).where(eq(schema.room.id, roomId))
}

export async function touchRoomOpened(roomId: string): Promise<void> {
  await db
    .update(schema.room)
    .set({ lastOpenedAt: new Date() })
    .where(eq(schema.room.id, roomId))
}

export async function setRoomThumbnailManifest(
  roomId: string,
  thumbnailManifest: ThumbnailManifest
): Promise<void> {
  await db
    .update(schema.room)
    .set({ thumbnailManifest, thumbnailUpdatedAt: new Date() })
    .where(eq(schema.room.id, roomId))
}

export async function touchRoomThumbnailUpdatedAt(
  roomId: string
): Promise<void> {
  await db
    .update(schema.room)
    .set({ thumbnailUpdatedAt: new Date() })
    .where(eq(schema.room.id, roomId))
}

export async function getRoomThumbnailUpdatedAt(
  roomId: string
): Promise<number | null> {
  const rows = await db
    .select({ thumbnailUpdatedAt: schema.room.thumbnailUpdatedAt })
    .from(schema.room)
    .where(eq(schema.room.id, roomId))
    .limit(1)
  return rows[0]?.thumbnailUpdatedAt?.getTime() ?? null
}

export async function getMembership(
  roomId: string,
  userId: string
): Promise<RoomMemberRecord | null> {
  const rows = await db
    .select()
    .from(schema.roomMember)
    .where(
      and(
        eq(schema.roomMember.roomId, roomId),
        eq(schema.roomMember.userId, userId)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    roomId: row.roomId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt.getTime(),
  }
}

export async function listMembers(roomId: string): Promise<RoomMemberRecord[]> {
  const rows = await db
    .select()
    .from(schema.roomMember)
    .where(eq(schema.roomMember.roomId, roomId))
  return rows.map((r) => ({
    roomId: r.roomId,
    userId: r.userId,
    role: r.role,
    createdAt: r.createdAt.getTime(),
  }))
}

export async function addMember(opts: {
  roomId: string
  userId: string
  role?: RoomRole
}): Promise<void> {
  await db
    .insert(schema.roomMember)
    .values({
      roomId: opts.roomId,
      userId: opts.userId,
      role: opts.role ?? "editor",
    })
    .onConflictDoUpdate({
      target: [schema.roomMember.roomId, schema.roomMember.userId],
      set: { role: sql`excluded.role` },
    })
}

export async function removeMember(
  roomId: string,
  userId: string
): Promise<void> {
  await db
    .delete(schema.roomMember)
    .where(
      and(
        eq(schema.roomMember.roomId, roomId),
        eq(schema.roomMember.userId, userId)
      )
    )
}

export async function canAccess(
  roomId: string,
  userId: string
): Promise<boolean> {
  // The local build collapses access to the single seeded local user — there is
  // no `room_member` table and nobody else to gate against (PRD #404, #417).
  if (isLocalBuild) return true
  const membership = await getMembership(roomId, userId)
  return membership !== null
}

export async function requireMember(
  roomId: string,
  userId: string
): Promise<RoomMemberRecord> {
  // Single local user — always a member, as the implicit owner.
  if (isLocalBuild) {
    return { roomId, userId, role: "owner", createdAt: 0 }
  }
  const membership = await getMembership(roomId, userId)
  if (!membership) throw new Error("You don't have access to this project")
  return membership
}

export async function requireOwner(
  roomId: string,
  userId: string
): Promise<RoomRecord> {
  const room = await getRoom(roomId)
  if (!room) throw new Error("Project not found")
  if (room.ownerId !== userId) {
    throw new Error("Only the project owner can do this")
  }
  return room
}
