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
