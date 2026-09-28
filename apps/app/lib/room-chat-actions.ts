"use server"

import { openRoom } from "@/lib/room-access"
import { ensureRoomChat } from "@/lib/room-chat"

/**
 * Create the Room's Coordinator chat the first time the chat panel shows it.
 * Any member of the Room may; a non-member is refused before the doc is read.
 */
export async function ensureRoomChatAction(roomId: string): Promise<string> {
  return ensureRoomChat(await openRoom(roomId))
}
