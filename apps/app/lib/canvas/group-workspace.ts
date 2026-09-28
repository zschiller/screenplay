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
 * Which of a Group's frames a Group Workspace switch moves (#869): every frame
 * that follows the Group, including one with no Workspace yet. Exceptions stay
 * where they are. Documents are never part of a switch.
 */
export function groupSwitchFrames(
  group: Pick<IframeLayerGroupData, "branchId" | "members" | "iframeLayerIds">,
  framesById: ReadonlyMap<string, FrameBranch>
): { following: string[]; exceptions: string[] } {
  const groupBranch = groupBranchId(group, framesById)
  const following: string[] = []
  const exceptions: string[] = []
  for (const m of getGroupMembers(group as IframeLayerGroupData)) {
    if (m.kind !== "iframe-layer") continue
    const frame = framesById.get(m.id)
    if (!frame) continue
    if (isWorkspaceException(frame, groupBranch)) exceptions.push(m.id)
    else following.push(m.id)
  }
  return { following, exceptions }
}

/**
 * The Group switcher's footer (#869), read before picking: how many frames
 * move, and which exceptions stay where they are.
 */
export function groupSwitchSummary(
  moving: number,
  exceptions: ReadonlyArray<{ name: string; workspace?: string }>
): string[] {
  const lines = [
    moving === 0
      ? "No frames follow this group."
      : moving === 1
        ? "Moves 1 frame. It keeps its route and state."
        : `Moves ${moving} frames. Each keeps its route and state.`,
  ]
  if (exceptions.length === 1) {
    const [only] = exceptions
    lines.push(
      only.workspace
        ? `${only.name} stays on ${only.workspace}.`
        : `${only.name} stays where it is.`
    )
  } else if (exceptions.length > 1) {
    const names = exceptions.map((e) => e.name)
    const listed =
      names.length <= 3
        ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
        : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
    lines.push(`${listed} stay on their own workspaces.`)
  }
  return lines
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
