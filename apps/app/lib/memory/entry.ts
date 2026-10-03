import { nanoid } from "nanoid"
import type { MemoryData } from "@/lib/types"

/**
 * What canvas memory (`./canvas`) and account memory (`./account`) share: one
 * entry shape, one length cap and one prompt limit, so the two scopes can't
 * drift apart.
 */

/** The longest entry kept, in characters. Memory is notes, not documents. */
export const MEMORY_ENTRY_MAX_LENGTH = 1000

/** The most entries a system prompt carries per scope; the newest win. */
export const MEMORY_PROMPT_LIMIT = 100

/** Trim an entry's text and cap its length; empty text is `null`. */
export function normalizeMemoryText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return trimmed.length > MEMORY_ENTRY_MAX_LENGTH
    ? trimmed.slice(0, MEMORY_ENTRY_MAX_LENGTH)
    : trimmed
}

/** Who saves an entry: an agent's chat, or a person in settings. */
export type MemorySource = "agent" | "member"

/** Who saved an entry. Entries the Coordinator saved before #1513 say
 *  `coordinator`; they read as any other agent's. */
export function memorySource(entry: Pick<MemoryData, "source">): MemorySource {
  return entry.source === "member" ? "member" : "agent"
}

/** A new entry, or `null` when the text is empty. */
export function newMemoryEntry(input: {
  text: string
  source: MemorySource
  now?: number
}): MemoryData | null {
  const text = normalizeMemoryText(input.text)
  if (!text) return null
  const now = input.now ?? Date.now()
  return {
    id: `mem-${nanoid(8)}`,
    text,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  }
}
