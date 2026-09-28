/**
 * Sidebar Drop — the one decision behind a drag in the Room Sidebar: the
 * Canvas list (Groups and their Members, {@link resolveSidebarDrop}) and the
 * Repositories list (Repos and their Branches, {@link resolveRepoListDrop}).
 * Pure: no React, no dnd-kit, no Yjs. Every reorder in both lists goes through
 * one gap algorithm, {@link reorderToGap}.
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
 * New order with `id` slotted into gap `gap` (0 = before the first item, N =
 * after the last), or null when nothing moves. The gap is counted with the
 * source still in the list, as the sidebar shows it. The one reorder algorithm
 * for Groups, Repos and Branches: a before/after drop on a row is the gap on
 * that side of it.
 */
export function reorderToGap(
  ids: readonly string[],
  id: string,
  gap: number
): string[] | null {
  const currentIdx = ids.indexOf(id)
  if (currentIdx < 0) return null
  const target = currentIdx < gap ? gap - 1 : gap
  const withoutSource = ids.filter((_, i) => i !== currentIdx)
  const clamped = Math.max(0, Math.min(target, withoutSource.length))
  const next = [
    ...withoutSource.slice(0, clamped),
    id,
    ...withoutSource.slice(clamped),
  ]
  return next.join(",") === ids.join(",") ? null : next
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
    const orderedIds = reorderToGap(
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

// --- Repositories list: Repos and their Branches ---

/** A Repo in sidebar order with its Branch ids in sidebar order. */
export type SidebarDropRepo = { id: string; branchIds: readonly string[] }

/**
 * The Repositories list's drop indicator: a before/after line on one Branch
 * row. Repos and Branches only reorder, never nest, so there's no `into`, and
 * Repo drags land in `repogap:N` strips that light themselves up.
 */
export type RepoListDropHint = {
  kind: "line"
  rowId: string
  edge: "before" | "after"
}

export type RepoListDropIntent =
  | { kind: "reorder-repos"; orderedIds: string[] }
  | { kind: "reorder-branches"; repoId: string; orderedIds: string[] }

export type RepoListDrop = {
  hint: RepoListDropHint | null
  intent: RepoListDropIntent | null
}

const NO_REPO_DROP: RepoListDrop = { hint: null, intent: null }

/**
 * The Repositories list's counterpart of {@link resolveSidebarDrop}. Ids are
 * `repo:ID`, `branch:ID` and `repogap:N` (the strip before Repo N). A Repo
 * moves only into a gap strip; a Branch moves only before/after a sibling in
 * its own Repo, so it can never be filed under a foreign Repo.
 */
export function resolveRepoListDrop({
  repos,
  activeId,
  overId,
  side,
}: {
  repos: readonly SidebarDropRepo[]
  activeId: string
  overId: string
  side: "before" | "after"
}): RepoListDrop {
  if (activeId === overId) return NO_REPO_DROP

  if (activeId.startsWith("repo:")) {
    if (!overId.startsWith("repogap:")) return NO_REPO_DROP
    const orderedIds = reorderToGap(
      repos.map((r) => r.id),
      activeId.slice(5),
      Number(overId.slice(8))
    )
    return {
      hint: null,
      intent: orderedIds ? { kind: "reorder-repos", orderedIds } : null,
    }
  }

  if (!activeId.startsWith("branch:") || !overId.startsWith("branch:"))
    return NO_REPO_DROP
  const branchId = activeId.slice(7)
  const repo = repos.find((r) => r.branchIds.includes(branchId))
  const overIdx = repo?.branchIds.indexOf(overId.slice(7)) ?? -1
  if (!repo || overIdx < 0) return NO_REPO_DROP

  // "After this Branch" paints as "before the next one", so each gap is one
  // pixel. Both name the same gap.
  const nextId = repo.branchIds[overIdx + 1]
  const hint: RepoListDropHint =
    side === "after" && nextId !== undefined
      ? { kind: "line", rowId: `branch:${nextId}`, edge: "before" }
      : { kind: "line", rowId: overId, edge: side }
  const orderedIds = reorderToGap(
    repo.branchIds,
    branchId,
    side === "after" ? overIdx + 1 : overIdx
  )
  return {
    hint,
    intent: orderedIds
      ? { kind: "reorder-branches", repoId: repo.id, orderedIds }
      : null,
  }
}
