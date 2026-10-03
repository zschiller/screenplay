import { COLLECTION_KEYS, createRoomCollections } from "@/lib/yjs/schema"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import type { RoomCollections } from "@/lib/yjs/schema"
import type { FileEntryData } from "@/lib/types"
import { createFiles, type FileIndex, type Files } from "./files"
import { canvasFileKeyPrefix } from "./paths"
import type { FileStore } from "./store"

/**
 * **Canvas Files** (#1514): files agents saved for the canvas's members,
 * never shown on the canvas. Their entries live in the Room's Y.Doc (shared
 * live with members, like canvas memory); their bytes live in the private
 * file store under `canvas/<roomId>/`.
 */

/** The Room collections that hold a files module index. */
export type RoomFileCollection = "files" | "skills"

/** Every entry of one of the Room's file indexes, read from the raw Y.Map. */
export function readRoomFileEntries(
  collections: RoomCollections,
  key: RoomFileCollection
): FileEntryData[] {
  // The raw Y.Map, not `toArray()`: its cache only refreshes while something
  // observes it, and nothing does on the server.
  return Object.values(
    collections.doc.getMap(COLLECTION_KEYS[key]).toJSON()
  ) as FileEntryData[]
}

/** Every Canvas Files entry in `collections`. */
export function readCanvasFiles(collections: RoomCollections): FileEntryData[] {
  return readRoomFileEntries(collections, "files")
}

/**
 * A files module index over one of a Room's collections: Canvas Files'
 * (`files`), or Canvas Skills' (`skills`, `lib/skills/saved.ts`).
 */
export function roomFileIndex(
  room: RoomDoc,
  key: RoomFileCollection
): FileIndex {
  return {
    entries: () => room.readDoc((c) => readRoomFileEntries(c, key)),
    mutate: (fn) =>
      room.mutateDoc(({ doc }) => {
        // A fresh view per write: nothing observes a server doc.
        const c = createRoomCollections(doc)
        return fn({
          all: () => readRoomFileEntries(c, key),
          set: (entry) => c[key].set(entry.id, entry),
          delete: (id) => c[key].delete(id),
        })
      }),
  }
}

/** The Canvas Files index over a Room's doc. */
export function canvasFileIndex(room: RoomDoc): FileIndex {
  return roomFileIndex(room, "files")
}

/** A Room's Canvas Files over `store`. */
export function canvasFilesOn(room: RoomDoc, store: FileStore): Files {
  return createFiles({
    index: canvasFileIndex(room),
    store,
    keyPrefix: canvasFileKeyPrefix(room.roomId),
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
