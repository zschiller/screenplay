import type { MemoryData } from "@/lib/types"
import { newMemoryEntry, normalizeMemoryText, type MemorySource } from "./entry"

/**
 * **Account memory** (#1513): one person's preferences, which every chat they
 * send a turn in reads, on any canvas. The entries are canvas memory's
 * (`./canvas`), with the same verbs and limits; they live in a per-person
 * store instead of a Room's Y.Doc. Settings › Memory and the agent tools both
 * go through these verbs.
 */

/** Where one person's account memory lives. Production is the encrypted
 *  per-user KV (`./account-store`), beside their Repositories. */
export interface AccountMemoryStore {
  load(): Promise<MemoryData[]>
  save(entries: MemoryData[]): Promise<void>
}

/** Every entry, oldest first (the order they were saved in). */
export async function readAccountMemory(
  store: AccountMemoryStore
): Promise<MemoryData[]> {
  return [...(await store.load())].sort((a, b) => a.createdAt - b.createdAt)
}

/** Save a new entry. Returns it, or `null` when the text is empty. */
export async function addAccountMemory(
  store: AccountMemoryStore,
  input: { text: string; source: MemorySource; now?: number }
): Promise<MemoryData | null> {
  const entry = newMemoryEntry(input)
  if (!entry) return null
  await store.save([...(await store.load()), entry])
  return entry
}

/** Replace an entry's text. Returns `false` when it no longer exists. */
export async function editAccountMemory(
  store: AccountMemoryStore,
  id: string,
  input: { text: string; now?: number }
): Promise<boolean> {
  const text = normalizeMemoryText(input.text)
  const entries = await store.load()
  if (!text || !entries.some((m) => m.id === id)) return false
  const updatedAt = input.now ?? Date.now()
  await store.save(
    entries.map((m) => (m.id === id ? { ...m, text, updatedAt } : m))
  )
  return true
}

/** Delete an entry. Returns `false` when it no longer exists. */
export async function removeAccountMemory(
  store: AccountMemoryStore,
  id: string
): Promise<boolean> {
  const entries = await store.load()
  if (!entries.some((m) => m.id === id)) return false
  await store.save(entries.filter((m) => m.id !== id))
  return true
}

/** A store held in memory, for tests and fixtures. */
export function inMemoryAccountMemoryStore(
  entries: MemoryData[] = []
): AccountMemoryStore {
  let list = [...entries]
  return {
    load: async () => [...list],
    save: async (next) => {
      list = [...next]
    },
  }
}
