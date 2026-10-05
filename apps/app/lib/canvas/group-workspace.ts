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
 * shows, and every Document a chat made in it belongs to (#1314). A Group of
 * one flow names it once and its layers leave it off; a Group of parallel
 * explorations (frames on different Workspaces, or some with none yet) names
 * none, and every layer names its own. A Document someone made by hand names
 * nothing, so it never splits the Group.
 *
 * `null` when the label names no Workspace: its layers differ, or it has none.
 * `branchId` is unset when no frame has a Workspace yet, and the label offers
 * "Choose a chat" for all of them (#871). `frames` are the Group's frame
 * ids, which a pick from the label moves; a Group of a chat's Documents alone
 * has none.
 *
 * `documentWorkspaces` maps a Document or Mockup (#1309) to the Workspace of
 * the chat that last changed it (`layerWorkspaceIds` in `./layer-chat`): a
 * chat's Mockups count like its Documents.
 */
export function groupWorkspace(
  group: Pick<IframeLayerGroupData, "members" | "iframeLayerIds">,
  framesById: Pick<ReadonlyMap<string, FrameBranch>, "get">,
  documentWorkspaces?: Pick<ReadonlyMap<string, string>, "get">
): { branchId: string | undefined; frames: string[] } | null {
  const frames: string[] = []
  const branchIds = new Set<string | undefined>()
  for (const m of getGroupMembers(group as IframeLayerGroupData)) {
    if (m.kind === "markdown-layer" || m.kind === "mockup-layer") {
      const branchId = documentWorkspaces?.get(m.id)
      if (branchId) branchIds.add(branchId)
      continue
    }
    const frame = framesById.get(m.id)
    if (!frame) continue
    frames.push(m.id)
    branchIds.add(frame.branchId || undefined)
  }
  if (branchIds.size !== 1) return null
  const [branchId] = branchIds
  if (frames.length === 0 && !branchId) return null
  return { branchId, frames }
}
