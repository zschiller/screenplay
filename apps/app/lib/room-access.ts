import "server-only"

import { getUserId } from "@/lib/auth-helpers"
import { requireMember, type RoomRole } from "@/lib/rooms"
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
