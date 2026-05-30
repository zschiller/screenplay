import type * as Y from "yjs"

/**
 * Comment doorbells. Two named counters live in the room's Y.Doc and act as
 * server-bumped change signals — clients observe them and refetch. They are
 * *doorbells*, not data: Postgres remains the source of truth (see
 * `lib/comments.ts`). Splitting one overloaded counter into two named ones
 * keeps read-state churn (constant, per-user) from forcing a room-wide
 * refetch storm on every read.
 *
 * - `commentsRevision` (room-global) — rung on content changes
 *   (create/edit/delete/resolve); every client refetches.
 * - `commentsRead[userId]` (per-user) — rung on read-state changes
 *   (mark read/unread); only that user's tabs refresh.
 *
 * These are pure Y.Doc functions so they unit-test against a bare `Y.Doc`;
 * the room-scoped async wrappers (`signalContentChange`/`signalReadChange`)
 * apply them through `mutateRoomDoc`.
 */

const META_KEY = "meta"
const REVISION_KEY = "commentsRevision"
const READ_KEY = "commentsRead"

/** Reads the room-global content revision (0 before any content change). */
export function readCommentsRevision(doc: Y.Doc): number {
  const meta = doc.getMap(META_KEY)
  return (meta.get(REVISION_KEY) as number | undefined) ?? 0
}

/** Rings the room-global content doorbell so every client refetches. */
export function bumpCommentsRevision(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY)
  meta.set(REVISION_KEY, readCommentsRevision(doc) + 1)
}

/** Reads the acting user's read-state revision (0 before any read change). */
export function readCommentsRead(doc: Y.Doc, userId: string): number {
  const read = doc.getMap(READ_KEY)
  return (read.get(userId) as number | undefined) ?? 0
}

/**
 * Rings the per-user read-state doorbell so only the acting user's own tabs
 * recompute unread — reads happen constantly, so this stays off the
 * room-global counter to avoid a refetch storm.
 */
export function bumpCommentsRead(doc: Y.Doc, userId: string): void {
  const read = doc.getMap(READ_KEY)
  read.set(userId, readCommentsRead(doc, userId) + 1)
}
