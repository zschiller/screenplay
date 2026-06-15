import { IFRAME_LAYER_GROUP_GAP } from "@/lib/constants"
import type {
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  GroupMember,
  GroupMemberKind,
} from "@/lib/types"

/** Effective horizontal gap for a group — its own override, or the default. */
export function groupGap(group: IframeLayerGroupData): number {
  return group.gap ?? IFRAME_LAYER_GROUP_GAP
}

/**
 * Canonical member list for a group. Returns `group.members` if present;
 * falls back to deriving from the legacy `iframeLayerIds` field so call sites
 * don't have to special-case unmigrated data. The migration in
 * `getRoomCollections` writes `members` and clears `iframeLayerIds` on first
 * read, but we still defensive-default here so utilities are safe to call
 * before the migration has flushed.
 */
export function getGroupMembers(group: IframeLayerGroupData): GroupMember[] {
  if (group.members && group.members.length > 0) return group.members
  if (group.iframeLayerIds && group.iframeLayerIds.length > 0) {
    return group.iframeLayerIds.map((id) => ({
      kind: "iframe-layer" as const,
      id,
    }))
  }
  return []
}

/** Helper to filter to a single kind — handy for sandbox-only operations. */
export function getGroupMemberIds(
  group: IframeLayerGroupData,
  kind: GroupMemberKind
): string[] {
  return getGroupMembers(group)
    .filter((m) => m.kind === kind)
    .map((m) => m.id)
}

/**
 * Box dimensions for a group member, looked up against the right collection
 * by kind. Returns `null` if the referenced item is missing — callers should
 * skip those rather than render zero-sized placeholders.
 */
export function getMemberSize(
  member: GroupMember,
  iframeLayers: ReadonlyMap<string, IframeLayerData>,
  markdownLayers: ReadonlyMap<string, MarkdownLayerData>
): { width: number; height: number } | null {
  if (member.kind === "iframe-layer") {
    const ab = iframeLayers.get(member.id)
    return ab ? { width: ab.width, height: ab.height } : null
  }
  if (member.kind === "markdown-layer") {
    const d = markdownLayers.get(member.id)
    return d ? { width: d.width, height: d.height } : null
  }
  return null
}

export type GroupMemberLayout = {
  id: string
  kind: GroupMemberKind
  groupId: string
  /** 0-based index within the group. */
  index: number
  /** True for the rightmost member in the group. */
  isLast: boolean
  /** World-space rect (canvas coordinates). */
  x: number
  y: number
  width: number
  height: number
}

/** Backwards-compatible alias — most callers only consume iframeLayer layouts. */
export type IframeLayerLayout = GroupMemberLayout
export type IframeLayerLayoutMap = ReadonlyMap<string, GroupMemberLayout>

/**
 * Compute world-space rects for every group member, given the parent groups
 * and the underlying iframeLayer / document collections. Members inside a group
 * are flexed left-to-right with the group's gap between them; the group's
 * `(x, y)` anchors the leftmost member's top-left. Members not referenced by
 * any group are skipped — the migration in `getRoomCollections` ensures
 * every iframeLayer/document ends up in exactly one group.
 *
 * Both arguments accept readonly arrays so the caller can pass freshly
 * computed snapshots from a Yjs transaction without copying.
 */
export function computeIframeLayerLayouts(
  groups: readonly IframeLayerGroupData[],
  iframeLayers: readonly IframeLayerData[],
  markdownLayers: readonly MarkdownLayerData[] = []
): IframeLayerLayoutMap {
  const abById = new Map<string, IframeLayerData>()
  for (const ab of iframeLayers) abById.set(ab.id, ab)
  const docById = new Map<string, MarkdownLayerData>()
  for (const d of markdownLayers) docById.set(d.id, d)

  const map = new Map<string, GroupMemberLayout>()
  for (const group of groups) {
    let cursorX = group.x
    const members = getGroupMembers(group)
    const last = members.length - 1
    const gap = groupGap(group)
    for (let i = 0; i < members.length; i++) {
      const member = members[i]!
      const size = getMemberSize(member, abById, docById)
      if (!size) continue
      map.set(member.id, {
        id: member.id,
        kind: member.kind,
        groupId: group.id,
        index: i,
        isLast: i === last,
        x: cursorX,
        y: group.y,
        width: size.width,
        height: size.height,
      })
      cursorX += size.width + gap
    }
  }
  return map
}

/** Total width of a group's members plus inter-member gaps. */
export function groupContentWidth(
  group: IframeLayerGroupData,
  iframeLayers: readonly IframeLayerData[],
  markdownLayers: readonly MarkdownLayerData[] = []
): number {
  const abById = new Map(iframeLayers.map((a) => [a.id, a]))
  const docById = new Map(markdownLayers.map((d) => [d.id, d]))
  let width = 0
  let count = 0
  for (const m of getGroupMembers(group)) {
    const size = getMemberSize(m, abById, docById)
    if (!size) continue
    width += size.width
    count += 1
  }
  if (count > 1) width += (count - 1) * groupGap(group)
  return width
}

/** Tallest member in the group — used for union bounds and overlay. */
export function groupContentHeight(
  group: IframeLayerGroupData,
  iframeLayers: readonly IframeLayerData[],
  markdownLayers: readonly MarkdownLayerData[] = []
): number {
  const abById = new Map(iframeLayers.map((a) => [a.id, a]))
  const docById = new Map(markdownLayers.map((d) => [d.id, d]))
  let height = 0
  for (const m of getGroupMembers(group)) {
    const size = getMemberSize(m, abById, docById)
    if (size && size.height > height) height = size.height
  }
  return height
}

/**
 * Anchor coords for a brand-new single-member group placed alongside any
 * existing groups: viewport-centered when the canvas is empty, otherwise just
 * to the right of the rightmost group, top-aligned with the topmost.
 *
 * Pure so callers batching multiple placements in one transaction can pass an
 * accumulating "virtual" groups list.
 */
export function placeNewIframeLayerGroup(
  groups: readonly IframeLayerGroupData[],
  iframeLayers: readonly IframeLayerData[],
  viewportCenter: { x: number; y: number },
  width: number,
  height: number,
  markdownLayers: readonly MarkdownLayerData[] = []
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
    const w = groupContentWidth(g, iframeLayers, markdownLayers)
    if (g.x + w > maxRight) maxRight = g.x + w
  }
  return { x: maxRight + IFRAME_LAYER_GROUP_GAP, y: minY }
}

// ─── Whole-Canvas geometry derivation ──────────────────────────────────────
//
// These derivations turn a plain Canvas snapshot into the geometry the canvas
// draws and hit-tests each gesture frame: the effective (mid-drag) layout, the
// trailing "+ frame" placeholder rects, and the gap- and reorder-handle
// positions. They are pure — no React state, refs, or Yjs — so `canvas.tsx`
// can call them every frame and `layout.test.ts` can exercise them with plain
// fixtures.

/** World-space rect for a group's trailing "+ frame" placeholder slot. */
export type PlaceholderRect = {
  groupId: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * World-space geometry for one inter-member gap in a selected group.
 * `centerX` is the visual line position; `left`/`right` bound the full gap
 * area used for hover hit-testing; `top`/`bottom` clamp the handle to the
 * shared height of the two adjacent members.
 */
export type GapHandle = {
  groupId: string
  gapIndex: number
  centerX: number
  left: number
  right: number
  top: number
  bottom: number
}

/** World-space center of a member's reorder dot. */
export type ReorderHandle = {
  iframeLayerId: string
  centerX: number
  centerY: number
}

/** Selection snapshot the geometry derivation reads to decide what to draw. */
export type CanvasSelection = {
  iframeLayerIds: ReadonlySet<string>
  documentLayerIds: ReadonlySet<string>
  groupIds: ReadonlySet<string>
}

/**
 * A reorder drag in its "popped" phase: `memberId` floats at `cursor` offset
 * by `grabOffset` (the point inside the member the user grabbed at drag-start).
 * `grabOffset` may be `null`, in which case the member is centered under the
 * cursor.
 */
export type ActiveReorderDrag = {
  memberId: string
  cursor: { x: number; y: number }
  grabOffset: { x: number; y: number } | null
}

/**
 * Layouts as the user sees them mid-gesture. Identical to `base` unless a
 * reorder drag has popped a member out of its group: the popped member floats
 * at `drag.cursor - grabOffset` and its former siblings reflow left-to-right to
 * close the gap. Pure — the caller passes plain snapshots each gesture frame.
 */
export function computeEffectiveLayouts(
  base: IframeLayerLayoutMap,
  groups: readonly IframeLayerGroupData[],
  iframeLayers: readonly IframeLayerData[],
  markdownLayers: readonly MarkdownLayerData[],
  drag: ActiveReorderDrag | null
): IframeLayerLayoutMap {
  if (!drag) return base
  const popped = base.get(drag.memberId)
  if (!popped) return base
  const sourceGroup = groups.find((g) => g.id === popped.groupId)
  if (!sourceGroup) return base

  const abById = new Map(iframeLayers.map((a) => [a.id, a]))
  const docById = new Map(markdownLayers.map((d) => [d.id, d]))
  const result = new Map(base)

  // Override the popped member so it sits at `cursor - grab`, matching the
  // grab offset captured at drag-start (the member stays under the exact spot
  // the user grabbed, not centered) unless no offset was recorded.
  const grab = drag.grabOffset ?? { x: popped.width / 2, y: popped.height / 2 }
  result.set(drag.memberId, {
    ...popped,
    x: drag.cursor.x - grab.x,
    y: drag.cursor.y - grab.y,
  })

  // Reflow the source group's remaining members to close the gap.
  const remainingMembers = getGroupMembers(sourceGroup).filter(
    (m) => m.id !== drag.memberId
  )
  const gap = groupGap(sourceGroup)
  let cursorX = sourceGroup.x
  for (let i = 0; i < remainingMembers.length; i++) {
    const m = remainingMembers[i]!
    const size = getMemberSize(m, abById, docById)
    if (!size) continue
    result.set(m.id, {
      id: m.id,
      kind: m.kind,
      groupId: sourceGroup.id,
      index: i,
      isLast: i === remainingMembers.length - 1,
      x: cursorX,
      y: sourceGroup.y,
      width: size.width,
      height: size.height,
    })
    cursorX += size.width + gap
  }
  return result
}

/**
 * Trailing "+ frame" placeholder rect for every group that contains a selected
 * member (selecting the whole group hides it). When a member is popped out for
 * reorder, the placeholder anchors on the new last remaining member so its
 * outline tracks the reflowed row instead of staying at the original edge.
 */
export function computePlaceholderRects(
  groups: readonly IframeLayerGroupData[],
  layouts: IframeLayerLayoutMap,
  selection: CanvasSelection,
  poppedMemberId: string | null
): PlaceholderRect[] {
  const rects: PlaceholderRect[] = []
  for (const g of groups) {
    const allMembers = getGroupMembers(g)
    if (allMembers.length === 0) continue
    if (selection.groupIds.has(g.id)) continue
    // The affordance is "add another frame next to this one" — shown when any
    // member (iframe or markdown layer) in the group is individually selected.
    const hasSelected = allMembers.some((m) =>
      m.kind === "iframe-layer"
        ? selection.iframeLayerIds.has(m.id)
        : selection.documentLayerIds.has(m.id)
    )
    if (!hasSelected) continue
    const members =
      poppedMemberId && allMembers.some((m) => m.id === poppedMemberId)
        ? allMembers.filter((m) => m.id !== poppedMemberId)
        : allMembers
    if (members.length === 0) continue
    const lastMember = members[members.length - 1]!
    const lastLayout = layouts.get(lastMember.id)
    if (!lastLayout) continue
    rects.push({
      groupId: g.id,
      x: lastLayout.x + lastLayout.width + groupGap(g),
      y: lastLayout.y,
      width: lastLayout.width,
      height: lastLayout.height,
    })
  }
  return rects
}

/**
 * One handle per inter-member gap in every selected group. While a member is
 * popped out for reorder, the gaps adjacent to it don't make sense, so it's
 * filtered out before pairing neighbors.
 */
export function computeGapHandles(
  groups: readonly IframeLayerGroupData[],
  layouts: IframeLayerLayoutMap,
  selectedGroupIds: ReadonlySet<string>,
  poppedMemberId: string | null
): GapHandle[] {
  const handles: GapHandle[] = []
  if (selectedGroupIds.size === 0) return handles
  for (const g of groups) {
    if (!selectedGroupIds.has(g.id)) continue
    const allMembers = getGroupMembers(g)
    const visibleIds = poppedMemberId
      ? allMembers.filter((m) => m.id !== poppedMemberId).map((m) => m.id)
      : allMembers.map((m) => m.id)
    if (visibleIds.length < 2) continue
    for (let i = 1; i < visibleIds.length; i++) {
      const prev = layouts.get(visibleIds[i - 1]!)
      const next = layouts.get(visibleIds[i]!)
      if (!prev || !next) continue
      const top = Math.max(prev.y, next.y)
      const bottom = Math.min(prev.y + prev.height, next.y + next.height)
      const left = prev.x + prev.width
      const right = next.x
      handles.push({
        groupId: g.id,
        gapIndex: i,
        centerX: (left + right) / 2,
        left,
        right,
        top,
        bottom,
      })
    }
  }
  return handles
}

/**
 * One reorder dot per member in every selected group with 2+ members. The dot
 * center is the member's box center; the canvas draws it at constant pixel size
 * and starts a within-group reorder drag when one is pressed.
 */
export function computeReorderHandles(
  groups: readonly IframeLayerGroupData[],
  layouts: IframeLayerLayoutMap,
  selectedGroupIds: ReadonlySet<string>
): ReorderHandle[] {
  const handles: ReorderHandle[] = []
  if (selectedGroupIds.size === 0) return handles
  for (const g of groups) {
    if (!selectedGroupIds.has(g.id)) continue
    const members = getGroupMembers(g)
    if (members.length < 2) continue
    for (const m of members) {
      const layout = layouts.get(m.id)
      if (!layout) continue
      handles.push({
        iframeLayerId: m.id,
        centerX: layout.x + layout.width / 2,
        centerY: layout.y + layout.height / 2,
      })
    }
  }
  return handles
}

export type CanvasLayout = {
  /** Effective (mid-gesture) member layouts — see `computeEffectiveLayouts`. */
  layouts: IframeLayerLayoutMap
  placeholderRects: PlaceholderRect[]
  gapHandles: GapHandle[]
  reorderHandles: ReorderHandle[]
}

export type DeriveCanvasLayoutInput = {
  groups: readonly IframeLayerGroupData[]
  iframeLayers: readonly IframeLayerData[]
  markdownLayers: readonly MarkdownLayerData[]
  selection: CanvasSelection
  /** Active reorder drag, if a member is currently floating at the cursor. */
  activeReorderDrag: ActiveReorderDrag | null
  /**
   * The member popped out of its group for placeholder/handle geometry.
   * Distinct from `activeReorderDrag.memberId` because the popped affordances
   * update the instant a member lifts, before the cursor has moved.
   */
  poppedMemberId: string | null
  /**
   * In-flight gap override from an active gap-resize gesture: one group's gap
   * is replaced so the row reflows live while dragging, before the
   * `setGroupGap` Canvas Operation commits on release. Part of the in-flight
   * slice the Gesture Preview feeds — geometry stays in this module.
   */
  gapOverride?: { groupId: string; gap: number } | null
}

/**
 * Whole-Canvas geometry for one gesture frame: the effective layout plus the
 * placeholder rects and gap/reorder handle positions derived from it. The
 * single entry point `canvas.tsx` calls each frame, keeping all geometry in
 * this tested, React-free module.
 */
export function deriveCanvasLayout(
  input: DeriveCanvasLayoutInput
): CanvasLayout {
  const {
    groups: rawGroups,
    iframeLayers,
    markdownLayers,
    selection,
    activeReorderDrag,
    poppedMemberId,
    gapOverride,
  } = input
  // Apply the in-flight gap override up front so every downstream derivation
  // (layouts, gap handles, placeholders) sees the previewed gap — the gesture
  // doesn't recompute geometry, it just swaps one group's gap.
  const groups = gapOverride
    ? rawGroups.map((g) =>
        g.id === gapOverride.groupId ? { ...g, gap: gapOverride.gap } : g
      )
    : rawGroups
  const base = computeIframeLayerLayouts(groups, iframeLayers, markdownLayers)
  const layouts = computeEffectiveLayouts(
    base,
    groups,
    iframeLayers,
    markdownLayers,
    activeReorderDrag
  )
  return {
    layouts,
    placeholderRects: computePlaceholderRects(
      groups,
      layouts,
      selection,
      poppedMemberId
    ),
    gapHandles: computeGapHandles(
      groups,
      layouts,
      selection.groupIds,
      poppedMemberId
    ),
    reorderHandles: computeReorderHandles(groups, layouts, selection.groupIds),
  }
}

/**
 * Next "Group N" number for a freshly-created group. Picks `max(N) + 1` over
 * existing group names so reordering or deleting earlier groups never causes
 * a future group to collide with an existing name.
 */
export function nextGroupNumber(
  groups: readonly IframeLayerGroupData[]
): number {
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
