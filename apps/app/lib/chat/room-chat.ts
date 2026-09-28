import type { ChatSessionData } from "@/lib/types"

/**
 * The Room Target chat (`apps/app/CONTEXT.md`, "Room Target"): the one chat per
 * Room whose target is the whole Room, shown to users as the "Coordinator".
 * React-free and Yjs-free so the client and server share it.
 *
 * Its id is derived from the Room id, so "at most one per Room" holds by
 * construction: two clients (or a client and the stream route) that create it
 * at the same time write the same record, and no Room can hold a second one.
 */

const ROOM_CHAT_ID_PREFIX = "room-chat-"

/** What the Room Target chat is called in the UI. */
export const ROOM_CHAT_LABEL = "Coordinator"

/** The id of `roomId`'s Room Target chat. */
export function roomChatId(roomId: string): string {
  return `${ROOM_CHAT_ID_PREFIX}${roomId}`
}

/**
 * Whether `chatId` is shaped like a Room Target chat id. The stream route
 * refuses such an id for any other target, and for any Room but its own, so no
 * one can claim another Room's Coordinator chat by naming it first.
 */
export function isRoomChatId(chatId: string): boolean {
  return chatId.startsWith(ROOM_CHAT_ID_PREFIX)
}

/** The Room Target chat's identity record for `roomId`. */
export function roomChatSession(
  roomId: string,
  createdAt: number
): ChatSessionData {
  return {
    id: roomChatId(roomId),
    target: "room",
    label: ROOM_CHAT_LABEL,
    createdAt,
  }
}
