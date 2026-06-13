/**
 * Pin ordering rule — pure, dependency-free (no React, no Yjs, no DB) so the
 * "pins keep a dense order, a new pin appends to the end" policy is testable in
 * isolation. Mirrors `lib/sidebar-order` as the isolated, fixture-testable
 * ordering helper for the home sidebar's "Pinned" section (PRD #507).
 *
 * A user's pins carry an integer `position`; the list renders ascending by it.
 * Pinning appends past the current maximum, and a reorder rewrites the whole run
 * to a contiguous 0-based sequence so positions never drift apart.
 */

/**
 * The position a newly pinned item takes: one past the highest existing
 * position, or 0 when the user has no pins yet. Reads `positions` rather than
 * the count so a list with gaps (e.g. after an unpin) still appends cleanly past
 * its real maximum.
 */
export function appendPosition(positions: readonly number[]): number {
  if (positions.length === 0) return 0
  return Math.max(...positions) + 1
}

/**
 * Dense 0-based positions for an ordered list of pin ids — index `i` maps to
 * position `i`, collapsing any gaps left by unpins. Stable and non-mutating:
 * returns a fresh array and never touches the input.
 */
export function densePositions(
  orderedIds: readonly string[]
): { id: string; position: number }[] {
  return orderedIds.map((id, index) => ({ id, position: index }))
}
