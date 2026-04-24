import "server-only"

import * as Y from "yjs"
import { liveblocks } from "@/lib/liveblocks-server"
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
