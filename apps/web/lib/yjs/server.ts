import "server-only"

import { randomUUID } from "node:crypto"
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
 * Distributed `Omit` so callers can hand us a `ChatBroadcastEvent` minus the
 * `id` field — we mint the id here so producers don't have to.
 */
type ChatBroadcastInput = ChatBroadcastEvent extends infer T
  ? T extends { id: string }
    ? Omit<T, "id"> & { id?: string }
    : never
  : never

/**
 * Append a chat broadcast event to the room's Y.Doc. Connected clients
 * observe and feed it into the local chat store. Late joiners see the
 * in-progress stream automatically.
 *
 * Each event gets a stable id so clients can dedup if multiple subscribers
 * deliver it to the same store. On `chat-stream-end` we trim everything
 * before the end marker — the stream is over, the persisted ModelMessages
 * in the DB are the authoritative record of what happened, and leaving the
 * events around would let `findActiveStreamStart` re-replay a completed
 * turn over freshly-fetched history.
 */
export async function broadcastChatEventViaDoc(
  roomId: string,
  event: ChatBroadcastInput,
): Promise<void> {
  const withId = { ...event, id: event.id ?? randomUUID() } as ChatBroadcastEvent
  await yjsHost.mutateDoc(roomId, (doc) => {
    const map = doc.getMap(STREAM_EVENTS_KEY) as Y.Map<Y.Array<unknown>>
    let arr = map.get(event.chatId)
    if (!arr) {
      arr = new Y.Array<unknown>()
      map.set(event.chatId, arr)
    }
    arr.push([JSON.parse(JSON.stringify(withId)) as unknown])
    if (withId.type === "chat-stream-end" && arr.length > 1) {
      arr.delete(0, arr.length - 1)
    }
  })
}
