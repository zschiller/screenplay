import { ARTBOARD_GROUP_GAP } from "@/lib/constants"
import type { ArtboardData, ArtboardGroupData } from "@/lib/types"

/** Effective horizontal gap for a group — its own override, or the default. */
export function groupGap(group: ArtboardGroupData): number {
  return group.gap ?? ARTBOARD_GROUP_GAP
}

export type ArtboardLayout = {
  id: string
  groupId: string
  /** 0-based index within the group. */
  index: number
  /** True for the rightmost artboard in the group. */
  isLast: boolean
  /** World-space rect (canvas coordinates). */
  x: number
  y: number
  width: number
  height: number
}

export type ArtboardLayoutMap = ReadonlyMap<string, ArtboardLayout>

/**
 * Compute world-space rects for every artboard, given the parent groups.
 * Artboards inside a group are flexed left-to-right with the group's gap
 * between them; the group's `(x, y)` anchors the leftmost artboard's top-left.
 * Artboards not referenced by any group are skipped — the migration in
 * `getRoomCollections` ensures every artboard ends up in exactly one group.
 */
export function computeArtboardLayouts(
  groups: readonly ArtboardGroupData[],
  artboards: readonly ArtboardData[],
): ArtboardLayoutMap {
  const byId = new Map<string, ArtboardData>()
  for (const ab of artboards) byId.set(ab.id, ab)

  const map = new Map<string, ArtboardLayout>()
  for (const group of groups) {
    let cursorX = group.x
    const ids = group.artboardIds
    const last = ids.length - 1
    const gap = groupGap(group)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const ab = byId.get(id)
      if (!ab) continue
      map.set(id, {
        id,
        groupId: group.id,
        index: i,
        isLast: i === last,
        x: cursorX,
        y: group.y,
        width: ab.width,
        height: ab.height,
      })
      cursorX += ab.width + gap
    }
  }
  return map
}

/** Total width of a group's artboards plus inter-artboard gaps. */
export function groupContentWidth(
  group: ArtboardGroupData,
  artboards: readonly ArtboardData[],
): number {
  const byId = new Map(artboards.map((a) => [a.id, a]))
  let width = 0
  let count = 0
  for (const id of group.artboardIds) {
    const ab = byId.get(id)
    if (!ab) continue
    width += ab.width
    count += 1
  }
  if (count > 1) width += (count - 1) * groupGap(group)
  return width
}

/** Tallest artboard in the group — used for union bounds and overlay. */
export function groupContentHeight(
  group: ArtboardGroupData,
  artboards: readonly ArtboardData[],
): number {
  const byId = new Map(artboards.map((a) => [a.id, a]))
  let height = 0
  for (const id of group.artboardIds) {
    const ab = byId.get(id)
    if (ab && ab.height > height) height = ab.height
  }
  return height
}

/**
 * Anchor coords for a brand-new single-artboard group placed alongside any
 * existing groups: viewport-centered when the canvas is empty, otherwise just
 * to the right of the rightmost group, top-aligned with the topmost.
 *
 * Pure so callers batching multiple placements in one transaction can pass an
 * accumulating "virtual" groups/artboards list — Yjs observers (and therefore
 * `YjsCollection.toArray()`'s snapshot cache) don't refresh inside an
 * outer transaction, so reading the collections back mid-loop would yield
 * pre-batch state and every placement would land on top of the others.
 */
export function placeNewArtboardGroup(
  groups: readonly ArtboardGroupData[],
  artboards: readonly ArtboardData[],
  viewportCenter: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  if (groups.length === 0) {
    return {
      x: viewportCenter.x - width / 2,
      y: viewportCenter.y - height / 2,
    }
  }
  let minY = Infinity
  let maxRight = -Infinity
  for (const g of groups) {
    minY = Math.min(minY, g.y)
    const w = groupContentWidth(g, artboards)
    if (g.x + w > maxRight) maxRight = g.x + w
  }
  return { x: maxRight + ARTBOARD_GROUP_GAP, y: minY }
}

/**
 * Next "Group N" number for a freshly-created group. Picks `max(N) + 1` over
 * existing group names so reordering or deleting earlier groups never causes
 * a future group to collide with an existing name.
 */
export function nextGroupNumber(groups: readonly ArtboardGroupData[]): number {
  let max = 0
  for (const g of groups) {
    if (!g.name) continue
    const m = /^Group (\d+)$/.exec(g.name)
    if (!m) continue
    const n = parseInt(m[1]!, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}
