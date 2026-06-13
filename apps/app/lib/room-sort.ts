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

/** Sort direction: ascending (low→high, A→Z) or descending (high→low, Z→A). */
export type SortOrder = "asc" | "desc"

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
 * The ascending comparison for a sort key: name locale-aware A→Z, timestamps
 * oldest→newest. `sortRooms` flips its sign for descending order.
 */
function compareAscending<T extends RoomSortable>(
  a: T,
  b: T,
  sort: SortKey
): number {
  if (sort === "name") return a.name.localeCompare(b.name)
  if (sort === "created") return a.createdAt - b.createdAt
  return lastEditedAt(a) - lastEditedAt(b)
}

/**
 * Order `rooms` by `sort` in the given `order` (default descending). Stable and
 * non-mutating: ties keep their incoming relative order — multiplying the
 * comparator by the direction sign leaves ties at 0 — so equal timestamps or
 * names produce a deterministic result for a given input list.
 */
export function sortRooms<T extends RoomSortable>(
  rooms: readonly T[],
  sort: SortKey,
  order: SortOrder = "desc"
): T[] {
  const sign = order === "asc" ? 1 : -1
  return [...rooms].sort((a, b) => sign * compareAscending(a, b, sort))
}
