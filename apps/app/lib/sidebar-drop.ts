/**
 * Sidebar Drop — the one decision behind a drag in the Room Sidebar's Canvas
 * list (Groups and their Members). Pure: no React, no dnd-kit, no Yjs.
 *
 * Given the visible rows, the dragged row, the row or gap under the pointer,
 * and which half of that row the pointer is in, {@link resolveSidebarDrop}
 * returns BOTH the drop indicator to paint and the move to commit. The sidebar
 * calls it on every drag move (for the hint) and again on drop (for the
 * intent), so the move always lands where the indicator pointed.
 *
 * Member indices in the intent are gaps in the target Group's members as the
 * sidebar shows them (the dragged member still in place). Converting that to
 * the post-removal index a same-Group reorder needs is Group Operations' job,
 * not the caller's.
 */

import type { GroupMember } from "@/lib/types"

/** The minimum a row's member needs: which Layer it is. */
export type SidebarRowMember = { kind: string; id: string }

/**
 * One visible row in the Canvas list. `group-header` is the folder line for a
 * multi-member Group, `flat` is the single-member shorthand (no header), and
 * `member` is a child row inside a multi-member Group.
 */
export type SidebarRow<M extends SidebarRowMember = SidebarRowMember> =
  | { kind: "group-header"; groupId: string }
  | { kind: "flat"; groupId: string; member: M }
  | { kind: "member"; groupId: string; member: M }

/** A Group in sidebar order with its full member list. */
export type SidebarDropGroup = {
  id: string
  members: readonly SidebarRowMember[]
}

/** A parsed sortable / droppable id: a row, or a `gap:N` strip between Groups. */
export type SidebarTargetId =
  | { kind: "group-header"; groupId: string }
  | { kind: "flat"; groupId: string }
  | { kind: "member"; memberKind: string; memberId: string }
  | { kind: "gap"; sidebarIndex: number }

/**
 * The drop indicator, painted on exactly one row so a gap is always drawn at
 * one pixel.
 *   - `into`: nest the dragged member into this container row (full ring).
 *   - `line`: a thin rule on this row's `before`/`after` edge.
 * Gap strips light themselves up, so a gap target has no row hint.
 */
export type SidebarDropHint =
  | { kind: "into"; rowId: string }
  | { kind: "line"; rowId: string; edge: "before" | "after" }

export type MoveMemberTarget =
  | { kind: "into-group"; groupId: string; index: number }
  | { kind: "new-group"; sidebarIndex: number }

/** What the drop commits. */
export type SidebarDropIntent =
  | { kind: "move-member"; member: GroupMember; target: MoveMemberTarget }
  | { kind: "reorder-groups"; orderedIds: string[] }

export type SidebarDrop = {
  hint: SidebarDropHint | null
  intent: SidebarDropIntent | null
}

export function sidebarRowId(row: SidebarRow): string {
  if (row.kind === "group-header") return `group:${row.groupId}`
  if (row.kind === "flat") return `flat:${row.groupId}`
  return `member:${row.member.kind}:${row.member.id}`
}

export function parseSidebarRowId(id: string): SidebarTargetId | null {
  if (id.startsWith("gap:")) {
    return { kind: "gap", sidebarIndex: Number(id.slice(4)) }
  }
  if (id.startsWith("group:")) {
    return { kind: "group-header", groupId: id.slice(6) }
  }
  if (id.startsWith("flat:")) {
    return { kind: "flat", groupId: id.slice(5) }
  }
  if (id.startsWith("member:")) {
    const rest = id.slice(7)
    const colon = rest.indexOf(":")
    if (colon < 0) return null
    return {
      kind: "member",
      memberKind: rest.slice(0, colon),
      memberId: rest.slice(colon + 1),
    }
  }
  return null
}

/**
 * New Group order with `groupId` slotted into gap `sidebarIndex` (0 = before
 * the first Group, N = after the last), or null when nothing moves. The gap is
 * counted with the source Group still in the list, as the sidebar shows it.
 */
export function reorderGroupsToGap(
  groupIds: readonly string[],
  groupId: string,
  sidebarIndex: number
): string[] | null {
  const currentIdx = groupIds.indexOf(groupId)
  if (currentIdx < 0) return null
  const target = currentIdx < sidebarIndex ? sidebarIndex - 1 : sidebarIndex
  const withoutSource = groupIds.filter((_, i) => i !== currentIdx)
  const clamped = Math.max(0, Math.min(target, withoutSource.length))
  const next = [
    ...withoutSource.slice(0, clamped),
    groupId,
    ...withoutSource.slice(clamped),
  ]
  return next.join(",") === groupIds.join(",") ? null : next
}

const NONE: SidebarDrop = { hint: null, intent: null }

export function resolveSidebarDrop({
  rows,
  groups,
  activeId,
  overId,
  side,
}: {
  rows: readonly SidebarRow[]
  groups: readonly SidebarDropGroup[]
  /** Sortable id of the dragged row. */
  activeId: string
  /** Sortable id of the row or gap under the pointer. */
  overId: string
  /** Which half of the over row the pointer is in. */
  side: "before" | "after"
}): SidebarDrop {
  if (activeId === overId) return NONE
  const active = rows.find((r) => sidebarRowId(r) === activeId)
  if (!active) return NONE
  const over = parseSidebarRowId(overId)
  if (!over) return NONE

  const groupIndex = (id: string) => groups.findIndex((g) => g.id === id)
  const reorder = (sidebarIndex: number): SidebarDrop => {
    const orderedIds = reorderGroupsToGap(
      groups.map((g) => g.id),
      active.groupId,
      sidebarIndex
    )
    return {
      hint: null,
      intent: orderedIds ? { kind: "reorder-groups", orderedIds } : null,
    }
  }

  // Gap strip: a member splits out into a new Group there; a whole Group
  // (header or flat row) moves there, keeping its identity.
  if (over.kind === "gap") {
    if (active.kind !== "member") return reorder(over.sidebarIndex)
    return {
      hint: null,
      intent: {
        kind: "move-member",
        member: toGroupMember(active.member),
        target: { kind: "new-group", sidebarIndex: over.sidebarIndex },
      },
    }
  }

  const overGroupId =
    over.kind === "member"
      ? rows.find(
          (r) =>
            r.kind === "member" &&
            r.member.kind === over.memberKind &&
            r.member.id === over.memberId
        )?.groupId
      : over.groupId
  if (overGroupId === undefined) return NONE
  const sameGroup = overGroupId === active.groupId

  // A whole Group reorders before/after the Group it's over. Collision only
  // offers gap strips to a Group drag, so this is the fallback when no gap is
  // in reach; there's no row indicator for it.
  if (active.kind === "group-header") {
    if (sameGroup) return NONE
    const overIdx = groupIndex(overGroupId)
    if (overIdx < 0) return NONE
    return reorder(side === "after" ? overIdx + 1 : overIdx)
  }

  const member = toGroupMember(active.member)

  if (over.kind === "group-header") {
    // Own Group's header: extract into a new Group above this one, the same
    // move as the gap strip right above it. That strip owns the indicator, so
    // the header paints none.
    if (sameGroup) {
      const idx = groupIndex(overGroupId)
      if (idx < 0) return NONE
      return {
        hint: null,
        intent: {
          kind: "move-member",
          member,
          target: { kind: "new-group", sidebarIndex: idx },
        },
      }
    }
    // Another Group's header: append into it.
    const target = groups.find((g) => g.id === overGroupId)
    if (!target) return NONE
    return {
      hint: { kind: "into", rowId: overId },
      intent: {
        kind: "move-member",
        member,
        target: {
          kind: "into-group",
          groupId: overGroupId,
          index: target.members.length,
        },
      },
    }
  }

  // Another single-member row: merge after its one member, making a
  // two-member Group with a header.
  if (over.kind === "flat") {
    if (sameGroup) return NONE
    return {
      hint: { kind: "into", rowId: overId },
      intent: {
        kind: "move-member",
        member,
        target: { kind: "into-group", groupId: overGroupId, index: 1 },
      },
    }
  }

  // Beside another member: before/after it in its Group.
  const target = groups.find((g) => g.id === overGroupId)
  const overMemberIdx =
    target?.members.findIndex(
      (m) => m.kind === over.memberKind && m.id === over.memberId
    ) ?? -1
  if (overMemberIdx < 0) return NONE

  // "After this member" paints as "before the next member of the same Group",
  // so the gap between two members is one pixel, not two. Both name the same
  // insertion index.
  let hint: SidebarDropHint = { kind: "line", rowId: overId, edge: side }
  if (side === "after") {
    const idx = rows.findIndex((r) => sidebarRowId(r) === overId)
    const next = rows[idx + 1]
    if (next && next.kind === "member" && next.groupId === overGroupId)
      hint = { kind: "line", rowId: sidebarRowId(next), edge: "before" }
  }
  return {
    hint,
    intent: {
      kind: "move-member",
      member,
      target: {
        kind: "into-group",
        groupId: overGroupId,
        index: side === "after" ? overMemberIdx + 1 : overMemberIdx,
      },
    },
  }
}

function toGroupMember(m: SidebarRowMember): GroupMember {
  return { kind: m.kind, id: m.id } as GroupMember
}
