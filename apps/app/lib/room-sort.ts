/**
 * Homescreen room ordering — pure and dependency-free (no React, no actions)
 * so each sort key's rule is testable in isolation, mirroring
 * `lib/sidebar-order`.
 *
 * The home provider sorts whatever selection is on screen through
 * `sortRooms`; the function works over plain room summaries (anything with a
 * `name`, `createdAt`, and nullable `lastConnectionAt`).
 */

export type SortKey = "updated" | "created" | "name"

export type RoomSortable = {
  name: string
  createdAt: number
  lastConnectionAt: number | null
}

/**
 * A room's "last edited" instant: the later of its last connection and its
 * creation. A room that has never been opened (no last-connection timestamp)
 * falls back to its created timestamp.
 */
export function lastEditedAt(room: RoomSortable): number {
  return room.lastConnectionAt === null
    ? room.createdAt
    : Math.max(room.lastConnectionAt, room.createdAt)
}

/**
 * Order `rooms` by `sort` — "updated" by `lastEditedAt` descending, "created"
 * by `createdAt` descending, "name" locale-aware ascending. Stable and
 * non-mutating: ties keep their incoming relative order, so equal timestamps
 * or names produce a deterministic result for a given input list.
 */
export function sortRooms<T extends RoomSortable>(
  rooms: readonly T[],
  sort: SortKey
): T[] {
  const sorted = [...rooms]
  if (sort === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sort === "created") {
    sorted.sort((a, b) => b.createdAt - a.createdAt)
  } else {
    sorted.sort((a, b) => lastEditedAt(b) - lastEditedAt(a))
  }
  return sorted
}
