/**
 * Composer drafts, one per chat (#802).
 *
 * A draft is the composer's own TipTap document, so mentions and element tokens
 * come back intact. It lives in memory for the session and is mirrored to
 * `localStorage`, so switching Workspace (which unmounts the chat) or reloading
 * the page doesn't wipe what was typed. The composer clears it only once the
 * server has accepted the message; a refused send is held by the chat store
 * instead (see `failedSend`).
 */

const STORAGE_PREFIX = "composer-draft:"

const memory = new Map<string, unknown>()

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

/** The saved draft for `key`, or `undefined` when there is none. */
export function readDraft(key: string): unknown {
  if (memory.has(key)) return memory.get(key)
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return undefined
    const doc: unknown = JSON.parse(raw)
    memory.set(key, doc)
    return doc
  } catch {
    return undefined
  }
}

/** Save `doc` as the draft for `key`; `null` clears it. */
export function writeDraft(key: string, doc: unknown): void {
  if (doc == null) memory.delete(key)
  else memory.set(key, doc)
  if (typeof window === "undefined") return
  try {
    if (doc == null) window.localStorage.removeItem(storageKey(key))
    else window.localStorage.setItem(storageKey(key), JSON.stringify(doc))
  } catch {}
}
