import "server-only"

import { eq } from "drizzle-orm"
import { getUserId } from "@/lib/auth-helpers"
import { db } from "@/lib/db"
import { agentChat } from "@/lib/db/schema"
import { NOT_A_MEMBER, requireMember, type RoomRole } from "@/lib/rooms"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * **Room Access**: the one way a server entry point turns (session, Room) into
 * room-scoped capabilities. Holding a {@link RoomAccess} means the caller's
 * session was resolved and its user is a member of the Room (or is the local
 * build's single user), so an unauthorized room write can't be expressed.
 *
 * Membership, the local-build single-user collapse (via `requireMember`), and
 * the session lookup live behind {@link openRoom}; callers never see them.
 */
export interface RoomAccess {
  roomId: string
  userId: string
  role: RoomRole
  /** Transactional mutation of the room's Y.Doc, as `mutateRoomDoc`. */
  mutateDoc<T = void>(
    fn: (collections: RoomCollections) => T | Promise<T>
  ): Promise<T>
  /** Read-only access to the room's Y.Doc, as `readRoomDoc`. */
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
}

/**
 * Open a Room for the current session. Throws `"Unauthorized"` with no session
 * and `"You don't have access to this project"` for a signed-in non-member,
 * before anything touches the room doc.
 */
export async function openRoom(roomId: string): Promise<RoomAccess> {
  const userId = await getUserId()
  if (!userId) throw new Error("Unauthorized")
  const { role } = await requireMember(roomId, userId)
  return {
    roomId,
    userId,
    role,
    mutateDoc: (fn) => mutateRoomDoc(roomId, fn),
    readDoc: (fn) => readRoomDoc(roomId, fn),
  }
}

/** The chat's Room, or `null` when no turn has recorded the chat yet. */
export async function chatRoomId(chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ roomId: agentChat.roomId })
    .from(agentChat)
    .where(eq(agentChat.id, chatId))
    .limit(1)
  return row?.roomId ?? null
}

/**
 * {@link openRoom} for a route handler: the {@link RoomAccess}, or the
 * response to return instead (401 with no session, 403 for a non-member).
 * Passing a `chatId` also rejects a chat recorded under a different Room, so
 * a member of one Room can't reach another Room's chat by naming their own.
 */
export async function openRoomForRoute(
  roomId: string,
  chatId?: string
): Promise<RoomAccess | Response> {
  let room: RoomAccess
  try {
    room = await openRoom(roomId)
  } catch (e) {
    if (!(e instanceof Error)) throw e
    if (e.message === "Unauthorized") {
      return new Response("Unauthorized", { status: 401 })
    }
    if (e.message === NOT_A_MEMBER) {
      return new Response(NOT_A_MEMBER, { status: 403 })
    }
    throw e
  }
  if (chatId) {
    const owner = await chatRoomId(chatId)
    if (owner && owner !== roomId) {
      return new Response(NOT_A_MEMBER, { status: 403 })
    }
  }
  return room
}
