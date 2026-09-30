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
 * The Workspace a Group's label names (#1276): the one every frame in it
 * shows. A Group of one flow names it once and its frames leave it off; a
 * Group of parallel explorations (frames on different Workspaces, or some with
 * none yet) names none, and every frame names its own.
 *
 * `null` when the label names no Workspace: its frames differ, or it has none.
 * `branchId` is unset when no frame has a Workspace yet, and the label offers
 * "Choose a workspace" for all of them (#871). `frames` are the Group's frame
 * ids, which a pick from the label moves.
 */
export function groupWorkspace(
  group: Pick<IframeLayerGroupData, "members" | "iframeLayerIds">,
  framesById: Pick<ReadonlyMap<string, FrameBranch>, "get">
): { branchId: string | undefined; frames: string[] } | null {
  const frames: string[] = []
  const branchIds = new Set<string | undefined>()
  for (const m of getGroupMembers(group as IframeLayerGroupData)) {
    if (m.kind !== "iframe-layer") continue
    const frame = framesById.get(m.id)
    if (!frame) continue
    frames.push(m.id)
    branchIds.add(frame.branchId || undefined)
  }
  if (frames.length === 0 || branchIds.size > 1) return null
  return { branchId: [...branchIds][0], frames }
}

/**
 * The Group switcher's footer (#869), read before picking: how many frames
 * move.
 */
export function groupSwitchSummary(moving: number): string {
  return moving === 1
    ? "Moves 1 frame. It keeps its route and state."
    : `Moves ${moving} frames. Each keeps its route and state.`
}

/**
 * The footer under an unassigned Group's "Choose a workspace" list (#871):
 * the pick sets every frame in the Group.
 */
export function groupAssignSummary(frames: number): string {
  if (frames === 1) return "Applies to its frame."
  if (frames === 2) return "Applies to both frames."
  return `Applies to all ${frames} frames.`
}
