import type {
  BranchData,
  GroupMember,
  IframeLayerData,
  IframeLayerGroupData,
} from "@/lib/types"
import { groupBranchId } from "./group-workspace"
import { getGroupMembers } from "./layout"

/**
 * The frames that show a Workspace: each frame whose own Workspace it is, and
 * each frame with no Workspace of its own in a Group that shows it (such a
 * frame follows its Group). Documents and exception frames, which show another
 * Workspace, are never among them.
 */
function workspaceFrames(
  workspaceIds: ReadonlySet<string>,
  groups: IframeLayerGroupData[],
  iframeLayers: IframeLayerData[]
): Set<string> {
  const framesById = new Map(iframeLayers.map((l) => [l.id, l]))
  const frames = new Set(
    iframeLayers
      .filter((l) => l.branchId && workspaceIds.has(l.branchId))
      .map((l) => l.id)
  )
  for (const group of groups) {
    const branchId = groupBranchId(group, framesById)
    if (!branchId || !workspaceIds.has(branchId)) continue
    for (const m of getGroupMembers(group)) {
      if (m.kind === "iframe-layer" && !framesById.get(m.id)?.branchId)
        frames.add(m.id)
    }
  }
  return frames
}

/** How many frames Mark as done hides for this Workspace; see its toast. */
export function countWorkspaceFrames(
  branchId: string,
  groups: IframeLayerGroupData[],
  iframeLayers: IframeLayerData[]
): number {
  return workspaceFrames(new Set([branchId]), groups, iframeLayers).size
}

/** The toast Mark as done shows, next to its Undo. */
export function markedDoneMessage(title: string, frames: number): string {
  const marked = `Marked “${title}” done.`
  if (frames === 0) return marked
  if (frames === 1) return `${marked} Its frame is hidden.`
  return `${marked} Its ${frames} frames are hidden.`
}

/**
 * A Done Workspace's frames leave the Canvas (#976). Only its frames go:
 * documents and other Workspaces' frames in the same Group stay, and a Group
 * with nothing left to show goes with them. Nothing is deleted: the records
 * stay in the Room doc where they were, so Reopen shows them in their old
 * places.
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

  const hiddenFrames = workspaceFrames(done, groups, iframeLayers)
  const hidden = (m: GroupMember) =>
    m.kind === "iframe-layer" && hiddenFrames.has(m.id)
  const visibleGroups: IframeLayerGroupData[] = []
  for (const group of groups) {
    const members = getGroupMembers(group)
    const shown = members.filter((m) => !hidden(m))
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
