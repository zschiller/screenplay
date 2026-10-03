import { COLLECTION_KEYS, createRoomCollections } from "@/lib/yjs/schema"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import type { RoomCollections } from "@/lib/yjs/schema"
import type { FileEntryData } from "@/lib/types"
import { createFiles, type FileIndex, type Files } from "./files"
import type { FileStore } from "./store"

/**
 * **Canvas Files** (#1514): files agents saved for the canvas's members,
 * never shown on the canvas. Their entries live in the Room's Y.Doc (shared
 * live with members, like canvas memory); their bytes live in the private
 * file store under `canvas/<roomId>/`.
 */

/** Every Canvas Files entry in `collections`, read from the raw Y.Map. */
export function readCanvasFiles(collections: RoomCollections): FileEntryData[] {
  // The raw Y.Map, not `toArray()`: its cache only refreshes while something
  // observes it, and nothing does on the server.
  return Object.values(
    collections.doc.getMap(COLLECTION_KEYS.files).toJSON()
  ) as FileEntryData[]
}

/** The Canvas Files index over a Room's doc. */
export function canvasFileIndex(room: RoomDoc): FileIndex {
  return {
    entries: () => room.readDoc(readCanvasFiles),
    mutate: (fn) =>
      room.mutateDoc(({ doc }) => {
        // A fresh view per write: nothing observes a server doc.
        const c = createRoomCollections(doc)
        return fn({
          all: () => readCanvasFiles(c),
          set: (entry) => c.files.set(entry.id, entry),
          delete: (id) => c.files.delete(id),
        })
      }),
  }
}

/** A Room's Canvas Files over `store`. */
export function canvasFilesOn(room: RoomDoc, store: FileStore): Files {
  return createFiles({
    index: canvasFileIndex(room),
    store,
    keyPrefix: `canvas/${room.roomId}`,
  })
}

/**
 * Canvas Files for a system prompt. A read that fails leaves the prompt
 * without a file list rather than failing the turn.
 */
export async function loadCanvasFiles(
  room: RoomReader
): Promise<FileEntryData[]> {
  return (await room.readDoc(readCanvasFiles).catch(() => null)) ?? []
}
