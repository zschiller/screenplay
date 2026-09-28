import "server-only"

import { roomChatId, roomChatSession } from "@/lib/chat/room-chat"
import type { RoomAccess } from "@/lib/room-access"

/**
 * Create the Room's Room Target chat (the Coordinator) if it doesn't exist yet,
 * and return its id. Idempotent: the id is derived from the Room, and an
 * existing record is left untouched. Written on the server, so a user's ⌘Z
 * never undoes it.
 */
export async function ensureRoomChat(
  room: Pick<RoomAccess, "roomId" | "mutateDoc">
): Promise<string> {
  const id = roomChatId(room.roomId)
  await room.mutateDoc(({ chatSessions }) => {
    if (!chatSessions.get(id)) {
      chatSessions.set(id, roomChatSession(room.roomId, Date.now()))
    }
  })
  return id
}
