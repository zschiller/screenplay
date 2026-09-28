import type { IframeLayerData, IframeLayerGroupData } from "@/lib/types"
import { getGroupMembers } from "./layout"

type FrameBranch = Pick<IframeLayerData, "branchId">

/**
 * The Workspace (Branch) a Group shows, issue #868: its own `branchId`, else
 * the Workspace of its leftmost frame that has one. The fallback covers
 * Groups created before Groups carried a Workspace and by older clients, so
 * every reader agrees with the on-load conversion before it lands.
 */
export function groupBranchId(
  group: Pick<IframeLayerGroupData, "branchId" | "members" | "iframeLayerIds">,
  framesById: Pick<ReadonlyMap<string, FrameBranch>, "get">
): string | undefined {
  if (group.branchId) return group.branchId
  for (const m of getGroupMembers(group as IframeLayerGroupData)) {
    if (m.kind !== "iframe-layer") continue
    const branchId = framesById.get(m.id)?.branchId
    if (branchId) return branchId
  }
  return undefined
}

/**
 * True when a frame shows a different Workspace from its Group's. Such a
 * frame (an *exception*) names its Workspace on its own label; every other
 * frame leaves that to the Group.
 */
export function isWorkspaceException(
  frame: FrameBranch,
  groupBranch: string | undefined
): boolean {
  return !!frame.branchId && !!groupBranch && frame.branchId !== groupBranch
}

/**
 * The Workspace a frame shows once it joins a Group on `targetBranch` from a
 * Group on `fromBranch` (#870): a frame that followed its old Group follows the
 * new one, an exception keeps its own, and a Group with no Workspace yet
 * changes nothing. Shared by the move itself and the mid-drag preview.
 */
export function joinedFrameBranch(
  frame: FrameBranch,
  fromBranch: string | undefined,
  targetBranch: string | undefined
): string | undefined {
  if (!targetBranch || isWorkspaceException(frame, fromBranch)) {
    return frame.branchId
  }
  return targetBranch
}

type GroupRef = Pick<
  IframeLayerGroupData,
  "branchId" | "members" | "iframeLayerIds"
>

/**
 * While a Group of one frame is dragged hot onto `target`, the Workspace that
 * frame will show once dropped (#870), so the canvas can show it before the
 * drop. `undefined` when the drop changes nothing: a larger source keeps every
 * frame's Workspace, and an exception keeps its own.
 */
export function mergePreviewBranch(
  source: GroupRef,
  target: GroupRef,
  framesById: Pick<ReadonlyMap<string, FrameBranch>, "get">
): { layerId: string; branchId: string } | undefined {
  const members = getGroupMembers(source as IframeLayerGroupData)
  const only = members.length === 1 ? members[0] : undefined
  if (only?.kind !== "iframe-layer") return undefined
  const frame = framesById.get(only.id)
  if (!frame) return undefined
  const branchId = joinedFrameBranch(
    frame,
    groupBranchId(source, framesById),
    groupBranchId(target, framesById)
  )
  return branchId && branchId !== frame.branchId
    ? { layerId: only.id, branchId }
    : undefined
}
