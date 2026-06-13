/**
 * Folding a fresh thumbnail poll into the homescreen's room state — pure and
 * React-free so the merge rule is testable in isolation, mirroring
 * `lib/room-sort`.
 *
 * The homescreen polls `listRoomThumbnails` for the per-Room record's thumbnail
 * slice (the compose-on-display manifest + its capture time) and merges it into
 * the already-loaded summaries, so an open grid reflects a fresh capture round
 * without a full page reload. The merge only touches the thumbnail fields —
 * never name, ordering, or any optimistic local edit — and preserves the input
 * array's identity when nothing is newer, so React bails out of the re-render.
 */

import type { ThumbnailManifest } from "@/lib/thumbnail/manifest"

/** The thumbnail slice of a Room — what the poll reads and the merge folds in. */
export type RoomThumbnail = {
  id: string
  thumbnailUpdatedAt: number | null
  thumbnailManifest: ThumbnailManifest | null
}

/**
 * Update each room's thumbnail (manifest + capture time) from `thumbnails`,
 * keyed by id. A room only adopts a *strictly newer* capture time — an equal or
 * older one is a no-op, as is a room absent from the poll — so a stale or
 * reordered poll never clobbers a fresher capture. When nothing changes the
 * original `rooms` reference is returned unchanged, letting a `setState` updater
 * skip the re-render entirely.
 */
export function mergeRoomThumbnails<T extends RoomThumbnail>(
  rooms: T[],
  thumbnails: readonly RoomThumbnail[]
): T[] {
  if (thumbnails.length === 0) return rooms
  const byId = new Map(thumbnails.map((t) => [t.id, t]))
  let changed = false
  const next = rooms.map((room) => {
    const fresh = byId.get(room.id)
    if (!fresh) return room
    if ((fresh.thumbnailUpdatedAt ?? 0) <= (room.thumbnailUpdatedAt ?? 0)) {
      return room
    }
    changed = true
    return {
      ...room,
      thumbnailUpdatedAt: fresh.thumbnailUpdatedAt,
      thumbnailManifest: fresh.thumbnailManifest,
    }
  })
  return changed ? next : rooms
}
