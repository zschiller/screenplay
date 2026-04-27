/**
 * Liveblocks is the Yjs transport — canvas state lives in the Y.Doc and
 * presence lives in Yjs awareness, so Storage/Presence are intentionally
 * empty. The global augmentation is what `RoomProvider` reads to type-check
 * `initialStorage` / `initialPresence`.
 */
export type Storage = Record<string, never>
export type Presence = Record<string, never>

declare global {
  interface Liveblocks {
    Storage: Storage
    Presence: Presence
  }
}
