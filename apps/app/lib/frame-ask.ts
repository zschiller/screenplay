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

/**
 * A drawn Mockup box being sent (#1359): the id the Mockup will take, so its
 * prompt can name it, and where it lands, in canvas space.
 */
export type DrawnMockup = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * The prompt a drawn Mockup box's ask sends (#1359): what was typed, then which
 * Mockup to fill and its size as the viewport. The Mockup already exists, empty
 * and owned by the answering chat, so the chat writes it with `update_mockup`.
 * The `[mockup: <id>]` marker names it the way the system prompt describes.
 */
export function forMockup(
  prompt: string,
  mockupId: string,
  size: { width: number; height: number }
): string {
  const target = `Sketch it in Mockup [mockup: ${mockupId}] with update_mockup, for a ${Math.round(size.width)} × ${Math.round(size.height)} viewport.`
  const text = prompt.trim()
  return text ? `${text}\n\n${target}` : target
}

/**
 * Who answers a drawn frame's ask: a new chat, or a Workspace's own chat. On a
 * canvas with no repository a drawn Mockup box's ask goes to the Coordinator,
 * which makes Mockups itself while there are no Workspaces.
 */
export type FrameAnswerer =
  | { kind: "new-chat" }
  | { kind: "workspace"; branchId: string }
  | { kind: "coordinator" }

export const NEW_CHAT: FrameAnswerer = { kind: "new-chat" }

export const COORDINATOR: FrameAnswerer = { kind: "coordinator" }

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
