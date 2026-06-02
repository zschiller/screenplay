/**
 * Sidebar ordering rule — pure, dependency-free (no React, no Yjs) so the
 * "manual order replaces sort, lazily" policy is testable in isolation.
 *
 * Both the in-room sidebar's repo list and each repo's branch
 * list (Branches) reorder through these two helpers, mirroring the Canvas
 * section's group `sidebarOrder`. An item's effective position is its stored
 * `sidebarOrder`; items without one fall back to a caller-supplied comparator
 * (repos alphabetical by full name, branches by `createdAt`) and sort to the
 * end, so a list that's never been dragged keeps its automatic order and a
 * newly added item appends.
 */

/**
 * Order `items` by `sidebarOrder` (lowest first); items without a stored
 * `sidebarOrder` sort after every item that has one, tie-broken by
 * `fallbackCompare`. Stable and non-mutating.
 */
export function sortForSidebar<T extends { sidebarOrder?: number }>(
  items: readonly T[],
  fallbackCompare: (a: T, b: T) => number
): T[] {
  return [...items].sort((a, b) => {
    const ao = a.sidebarOrder ?? Number.POSITIVE_INFINITY
    const bo = b.sidebarOrder ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return fallbackCompare(a, b)
  })
}

/**
 * The new id ordering after a drag drops `activeId` onto `overId` — `activeId`
 * is pulled from its current slot and reinserted at `overId`'s slot (dnd-kit
 * `arrayMove` semantics). A no-op (returns a copy of `currentIds`) when the two
 * ids are equal or either is absent.
 */
export function reorderedIds(
  currentIds: readonly string[],
  activeId: string,
  overId: string
): string[] {
  const from = currentIds.indexOf(activeId)
  const to = currentIds.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return [...currentIds]
  const next = [...currentIds]
  next.splice(from, 1)
  next.splice(to, 0, activeId)
  return next
}
