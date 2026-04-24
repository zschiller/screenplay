import "server-only"

import * as Y from "yjs"
import type { ChatBroadcastEvent } from "@/lib/chat-store"
import { yjsHost } from "@/lib/yjs-host"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"

/**
 * Run a transactional mutation against a room's Y.Doc. Concurrent mutations
 * from different writers merge under Yjs CRDT semantics (per-field LWW for
 * the Y.Map<Y.Map> layout).
 */
export async function mutateRoomDoc<T = void>(
  roomId: string,
  fn: (collections: RoomCollections) => T | Promise<T>,
): Promise<T> {
  return yjsHost.mutateDoc(roomId, (doc) => fn(getRoomCollections(doc)))
}

/** Read-only convenience — same plumbing without writing back. */
export async function readRoomDoc<T>(
  roomId: string,
  fn: (collections: RoomCollections) => T | Promise<T>,
): Promise<T> {
  return yjsHost.readDoc(roomId, (doc) => fn(getRoomCollections(doc)))
}

const STREAM_EVENTS_KEY = "streamEventsByChat"

/**
 * Append a chat broadcast event to the room's Y.Doc. Connected clients
 * observe and feed it into the local chat store. Late joiners see the
 * in-progress stream automatically.
 */
export async function broadcastChatEventViaDoc(
  roomId: string,
  event: ChatBroadcastEvent,
): Promise<void> {
  await yjsHost.mutateDoc(roomId, (doc) => {
    const map = doc.getMap(STREAM_EVENTS_KEY) as Y.Map<Y.Array<unknown>>
    let arr = map.get(event.chatId)
    if (!arr) {
      arr = new Y.Array<unknown>()
      map.set(event.chatId, arr)
    }
    arr.push([JSON.parse(JSON.stringify(event)) as unknown])
  })
}
