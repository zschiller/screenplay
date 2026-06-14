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
 * keyed by id. A room only adopts a *strictly newer* manifest — an equal or
 * older one is a no-op, as is a room absent from the poll — so a stale or
 * reordered poll never clobbers a fresher one. When nothing changes the original
 * `rooms` reference is returned unchanged, letting a `setState` updater skip the
 * re-render entirely.
 *
 * Freshness keys off the manifest's monotonic `revision`, which every rebuild
 * bumps — capture *and* layout-only. The capture clock (`thumbnailUpdatedAt`)
 * can't be the gate: a layout-only write leaves it untouched on purpose (so it
 * doesn't trip the capture cooldown), so gating on it would silently discard a
 * moved/resized/renamed frame until the next capture or a full reload. We fall
 * back to the capture clock only when neither side carries a revision (legacy
 * rows written before the field existed); a revisioned manifest always wins over
 * a revisionless one.
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
    if (!isNewer(fresh, room)) return room
    changed = true
    return {
      ...room,
      thumbnailUpdatedAt: fresh.thumbnailUpdatedAt,
      thumbnailManifest: fresh.thumbnailManifest,
    }
  })
  return changed ? next : rooms
}

/** Is `fresh` a strictly newer thumbnail than `current`? */
function isNewer(fresh: RoomThumbnail, current: RoomThumbnail): boolean {
  const freshRev = fresh.thumbnailManifest?.revision
  const currentRev = current.thumbnailManifest?.revision
  // When either side carries a revision, it's the source of truth — every
  // rebuild bumps it, and a revisioned manifest (missing → -1) beats a legacy
  // revisionless one.
  if (freshRev != null || currentRev != null) {
    return (freshRev ?? -1) > (currentRev ?? -1)
  }
  // Both legacy: fall back to the capture clock, treating null as the oldest.
  return (fresh.thumbnailUpdatedAt ?? 0) > (current.thumbnailUpdatedAt ?? 0)
}
