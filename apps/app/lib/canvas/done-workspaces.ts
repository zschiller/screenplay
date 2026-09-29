import type {
  BranchData,
  GroupMember,
  IframeLayerData,
  IframeLayerGroupData,
} from "@/lib/types"
import { groupBranchId } from "./group-workspace"
import { getGroupMembers } from "./layout"

/**
 * A Done Workspace's frames leave the Canvas (#976): a Group whose Workspace
 * it is hides whole, documents included, and an exception frame on it hides on
 * its own. Nothing is deleted: the records stay in the Room doc where they
 * were, so Reopen shows them in their old places.
 *
 * This is the view the Canvas renders and lays out. Writes keep going through
 * the Room doc, where the hidden members still sit ({@link keepHiddenMembers}
 * puts them back into a reorder written from this view).
 */
export function hideDoneWorkspaceFrames({
  groups,
  iframeLayers,
  branches,
}: {
  groups: IframeLayerGroupData[]
  iframeLayers: IframeLayerData[]
  branches: Pick<BranchData, "id" | "doneAt">[]
}): { groups: IframeLayerGroupData[]; iframeLayers: IframeLayerData[] } {
  const done = new Set(branches.filter((b) => b.doneAt).map((b) => b.id))
  if (done.size === 0) return { groups, iframeLayers }

  const framesById = new Map(iframeLayers.map((l) => [l.id, l]))
  const hiddenFrames = new Set(
    iframeLayers
      .filter((l) => l.branchId && done.has(l.branchId))
      .map((l) => l.id)
  )
  const visibleGroups: IframeLayerGroupData[] = []
  for (const group of groups) {
    const branchId = groupBranchId(group, framesById)
    const members = getGroupMembers(group)
    if (branchId && done.has(branchId)) {
      for (const m of members) hiddenFrames.add(m.id)
      continue
    }
    const shown = members.filter((m) => !hiddenFrames.has(m.id))
    if (shown.length === members.length) visibleGroups.push(group)
    else if (shown.length > 0)
      visibleGroups.push({
        ...group,
        members: shown,
        iframeLayerIds: undefined,
      })
  }
  return {
    groups: visibleGroups,
    iframeLayers: iframeLayers.filter((l) => !hiddenFrames.has(l.id)),
  }
}

/**
 * A Group's members after a reorder made from the Canvas's view, which leaves
 * out hidden members (a Done Workspace's exception frames). Each hidden member
 * keeps its index; the visible ones fill the other slots in their new order.
 */
export function keepHiddenMembers(
  current: GroupMember[],
  reordered: GroupMember[]
): GroupMember[] {
  const visible = new Set(reordered.map((m) => m.id))
  if (current.every((m) => visible.has(m.id))) return reordered
  const next = [...reordered]
  const out: GroupMember[] = []
  for (const m of current) {
    if (visible.has(m.id)) {
      const shown = next.shift()
      if (shown) out.push(shown)
    } else out.push(m)
  }
  return [...out, ...next]
}
