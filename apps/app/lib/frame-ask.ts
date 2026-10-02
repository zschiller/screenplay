import { sortForSidebar } from "@/lib/sidebar-order"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  RepoData,
} from "@/lib/types"

/**
 * The Repo a new Workspace starts in: the one used last (the newest
 * Workspace's), else the first in sidebar order. The New Workspace dialog
 * preselects it, and the frame ask card's New chat creates in it.
 */
export function defaultNewWorkspaceRepoId(
  repos: RepoData[],
  branches: BranchData[]
): string | null {
  const sorted = sortForSidebar(repos, (a, b) =>
    a.repoFullName.localeCompare(b.repoFullName)
  )
  const repoIds = new Set(sorted.map((r) => r.id))
  let newest: BranchData | undefined
  for (const b of branches) {
    if (!repoIds.has(b.repoId)) continue
    if (!newest || b.createdAt > newest.createdAt) newest = b
  }
  return newest?.repoId ?? sorted[0]?.id ?? null
}

/**
 * The prompt a drawn frame's ask card sends: what was typed, then the frame's
 * size as the viewport, so a phone-sized box gets a mobile take.
 */
export function withViewport(
  prompt: string,
  size: { width: number; height: number }
): string {
  const viewport = `For a ${Math.round(size.width)} × ${Math.round(size.height)} viewport.`
  const text = prompt.trim()
  return text ? `${text}\n\n${viewport}` : viewport
}

/** Who answers a drawn frame's ask: a new chat, or a Workspace's own chat. */
export type FrameAnswerer =
  { kind: "new-chat" } | { kind: "workspace"; branchId: string }

export const NEW_CHAT: FrameAnswerer = { kind: "new-chat" }

/**
 * Who answers by default (#1357, spec #1355), from the canvas selection when
 * the frame was drawn: a selected frame's Workspace, a selected Mockup's or
 * Document's owner chat's Workspace, else a new chat. Several layers answer
 * together only when they all lead to one Workspace. A Workspace that can't be
 * picked (gone, failed, stopped) falls back to a new chat. Prompts to a
 * Workspace land in its one chat (`workspaceChatId`), so the Branch is enough.
 */
export function defaultFrameAnswerer(input: {
  /** Selected frames. */
  frameIds: Iterable<string>
  /** Selected Documents and Mockups (they share one selection). */
  ownedLayerIds: Iterable<string>
  frames: readonly Pick<IframeLayerData, "id" | "branchId">[]
  ownedLayers: readonly { id: string; ownerChatId?: string }[]
  chatSessions: readonly Pick<ChatSessionData, "id" | "branchId">[]
  /** The Workspaces the chip can pick. */
  pickable: readonly Pick<BranchData, "id">[]
}): FrameAnswerer {
  const framesById = new Map(input.frames.map((f) => [f.id, f]))
  const ownedById = new Map(input.ownedLayers.map((l) => [l.id, l]))
  const chatsById = new Map(input.chatSessions.map((c) => [c.id, c]))

  const branchIds = new Set<string | undefined>()
  for (const id of input.frameIds) branchIds.add(framesById.get(id)?.branchId)
  for (const id of input.ownedLayerIds) {
    const owner = ownedById.get(id)?.ownerChatId
    branchIds.add(owner ? chatsById.get(owner)?.branchId : undefined)
  }

  if (branchIds.size !== 1) return NEW_CHAT
  const [branchId] = branchIds
  if (!branchId || !input.pickable.some((b) => b.id === branchId))
    return NEW_CHAT
  return { kind: "workspace", branchId }
}
