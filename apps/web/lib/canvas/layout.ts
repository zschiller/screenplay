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
    return group.iframeLayerIds.map((id) => ({ kind: "iframe-layer" as const, id }))
  }
  return []
}

/** Helper to filter to a single kind — handy for sandbox-only operations. */
export function getGroupMemberIds(
  group: IframeLayerGroupData,
  kind: GroupMemberKind,
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
  markdownLayers: ReadonlyMap<string, MarkdownLayerData>,
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
  markdownLayers: readonly MarkdownLayerData[] = [],
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
  markdownLayers: readonly MarkdownLayerData[] = [],
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
  markdownLayers: readonly MarkdownLayerData[] = [],
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
  markdownLayers: readonly MarkdownLayerData[] = [],
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

/**
 * Next "Group N" number for a freshly-created group. Picks `max(N) + 1` over
 * existing group names so reordering or deleting earlier groups never causes
 * a future group to collide with an existing name.
 */
export function nextGroupNumber(groups: readonly IframeLayerGroupData[]): number {
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
