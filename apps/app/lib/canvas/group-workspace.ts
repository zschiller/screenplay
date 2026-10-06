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
 * Group of parallel explorations (frames on different Workspaces, or some
 * with none yet) names none, and every frame names its own. Documents and
 * Mockups name no chat on their labels (#1724), so they never count: a Group
 * without frames names nothing and offers no switcher.
 *
 * `null` when the label names no Workspace: its frames differ, or it has
 * none. `branchId` is unset when no frame has a Workspace yet, and the label
 * offers "Choose a chat" for all of them (#871). `frames` are the Group's
 * frame ids, which a pick from the label moves.
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
  if (branchIds.size !== 1) return null
  const [branchId] = branchIds
  return { branchId, frames }
}
