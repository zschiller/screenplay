import "server-only"

import * as Y from "yjs"
import { liveblocks } from "@/lib/liveblocks-server"
import type { ChatBroadcastEvent } from "@/lib/chat-store"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"

/**
 * Run a transactional mutation against a room's Y.Doc on the server. Loads
 * the doc snapshot from the Yjs host, applies `fn`, and ships the resulting
 * diff back. The doc is destroyed afterward — callers must not retain
 * references to anything inside `collections`.
 *
 * Concurrent mutations from different writers merge under Yjs CRDT semantics
 * (per-field LWW for our Y.Map<Y.Map> layout). If you need read-then-write
 * atomicity across multiple fields, return a value from `fn` that the caller
 * can validate before continuing.
 */
export async function mutateRoomDoc<T = void>(
  roomId: string,
  fn: (collections: RoomCollections) => T | Promise<T>,
): Promise<T> {
  const initial = await liveblocks.getYjsDocumentAsBinaryUpdate(roomId)
  const doc = new Y.Doc()
  if (initial.byteLength > 0) {
    Y.applyUpdate(doc, new Uint8Array(initial))
  }

  const beforeSV = Y.encodeStateVector(doc)
  const collections = getRoomCollections(doc)

  let result: T
  try {
    result = await fn(collections)
  } finally {
    const diff = Y.encodeStateAsUpdate(doc, beforeSV)
    if (diff.byteLength > 0) {
      try {
        await liveblocks.sendYjsBinaryUpdate(roomId, diff)
      } finally {
        doc.destroy()
      }
    } else {
      doc.destroy()
    }
  }
  return result
}

/** Read-only convenience — same plumbing without writing back. */
export async function readRoomDoc<T>(
  roomId: string,
  fn: (collections: RoomCollections) => T | Promise<T>,
): Promise<T> {
  const initial = await liveblocks.getYjsDocumentAsBinaryUpdate(roomId)
  const doc = new Y.Doc()
  if (initial.byteLength > 0) {
    Y.applyUpdate(doc, new Uint8Array(initial))
  }
  const collections = getRoomCollections(doc)
  try {
    return await fn(collections)
  } finally {
    doc.destroy()
  }
}

const STREAM_EVENTS_KEY = "streamEventsByChat"

/**
 * Append a chat broadcast event to the room's Y.Doc, where connected clients
 * observe and feed it into the local chat store. Replaces the prior
 * `liveblocks.broadcastEvent` flow — keeping events in the doc means late
 * joiners see the in-progress stream automatically.
 */
export async function broadcastChatEventViaDoc(
  roomId: string,
  event: ChatBroadcastEvent,
): Promise<void> {
  await mutateRoomDoc(roomId, ({ doc }) => {
    const map = doc.getMap(STREAM_EVENTS_KEY) as Y.Map<Y.Array<unknown>>
    let arr = map.get(event.chatId)
    if (!arr) {
      arr = new Y.Array<unknown>()
      map.set(event.chatId, arr)
    }
    // Y.Array values must be JSON-cloneable. The event already is.
    arr.push([JSON.parse(JSON.stringify(event)) as unknown])
  })
}
