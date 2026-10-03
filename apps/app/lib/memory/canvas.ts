import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"
import type { MemoryData } from "@/lib/types"
import { newMemoryEntry, normalizeMemoryText, type MemorySource } from "./entry"

export {
  MEMORY_ENTRY_MAX_LENGTH,
  MEMORY_PROMPT_LIMIT,
  normalizeMemoryText,
} from "./entry"

/**
 * **Canvas memory** (#902): the canvas's shared preferences, decisions and
 * facts about its repositories. Entries live in the Room's Y.Doc, so every
 * member and every client sees the same list. The Coordinator writes them with
 * its `write_memory` tool; members edit them in Canvas settings › Memory; every
 * chat on the canvas reads them in its system prompt.
 *
 * These verbs are the one way either writer changes the list, so the Canvas
 * settings section and the Coordinator tool can't disagree on the shape.
 * Account memory (`./account`) has the same verbs over a per-person store.
 */

/** Every entry, oldest first (the order they were saved in). */
export function readMemory(collections: RoomCollections): MemoryData[] {
  // The raw Y.Map, not `toArray()`: its cache only refreshes while something
  // observes it, and nothing does on the server.
  const entries = Object.values(
    collections.doc.getMap(COLLECTION_KEYS.memories).toJSON()
  ) as MemoryData[]
  return entries.sort((a, b) => a.createdAt - b.createdAt)
}

/** Save a new entry. Returns it, or `null` when the text is empty. */
export function addMemory(
  collections: RoomCollections,
  input: { text: string; source: MemorySource; now?: number }
): MemoryData | null {
  const entry = newMemoryEntry(input)
  if (!entry) return null
  collections.memories.set(entry.id, entry)
  return entry
}

/** Replace an entry's text. Returns `false` when it no longer exists. */
export function editMemory(
  collections: RoomCollections,
  id: string,
  input: { text: string; now?: number }
): boolean {
  const text = normalizeMemoryText(input.text)
  if (!text || !collections.memories.has(id)) return false
  collections.memories.update(id, {
    text,
    updatedAt: input.now ?? Date.now(),
  })
  return true
}

/** Delete an entry. Returns `false` when it no longer exists. */
export function removeMemory(
  collections: RoomCollections,
  id: string
): boolean {
  if (!collections.memories.has(id)) return false
  collections.memories.delete(id)
  return true
}
