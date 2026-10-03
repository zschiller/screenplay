import { isSketchChat } from "@/lib/chat/sketch-chat"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import type { ChatSessionData, MarkdownLayerData } from "@/lib/types"

/**
 * Who a Document belongs to (#1314): the chat that made it, recorded as its
 * `ownerChatId`. That chat edits it with its tools, its name shows on it, and
 * Send to agent and Reply in chat on it go there. A Document someone made by
 * hand has no owner. Once its chat is deleted a Document or Mockup is
 * orphaned: any chat may edit it, and the first that does claims it.
 * React-free, tested against plain values.
 */

type Doc = Pick<MarkdownLayerData, "id" | "ownerChatId">

/**
 * Whether a chat may change a Document or Mockup with its tools: `own` when it
 * made it, `claim` when the chat that made it was deleted (the edit makes it
 * this chat's), `theirs` when another chat still on the canvas made it or a
 * person made it by hand.
 */
export type EditRight = "own" | "claim" | "theirs"

export function editRight(
  ownerChatId: string | undefined,
  chatId: string,
  chatExists: (id: string) => boolean
): EditRight {
  if (!ownerChatId) return "theirs"
  if (ownerChatId === chatId) return "own"
  return chatExists(ownerChatId) ? "theirs" : "claim"
}

/** Whether a layer's chat was deleted, leaving it for any chat to edit. */
export function isOrphaned(
  ownerChatId: string | undefined,
  chats: readonly Pick<ChatSessionData, "id">[]
): boolean {
  return !!ownerChatId && !chats.some((c) => c.id === ownerChatId)
}

/** A chat on the canvas, as far as the owner rule reads it. */
type OwnerChat = Pick<ChatSessionData, "id" | "branchId" | "target"> & {
  /** Picks the Workspace chat among several; a chat without it reads oldest. */
  createdAt?: number
}

/**
 * Who a chat-made Document or Mockup goes back to: the one rule Documents,
 * Mockups, Reply in chat, Send to agent, the Knobs Ask, Draw-and-ask and the
 * Workspace grouping all read. A layer a Sketch Chat made belongs to that
 * chat. A layer a Workspace's chat made belongs to the Workspace chat (#1315):
 * the same chat unless an earlier, read-only chat of the Workspace made it.
 */
export type LayerOwner =
  | { kind: "sketch"; chatId: string }
  | { kind: "workspace"; chatId: string; branchId: string }

/**
 * The owner of a layer whose `ownerChatId` is given. Null for a layer made by
 * hand, one whose chat was deleted ({@link isOrphaned}), or one the
 * Coordinator made.
 */
export function layerOwner(
  ownerChatId: string | undefined,
  chats: readonly OwnerChat[]
): LayerOwner | null {
  const chat = ownerChatId ? chats.find((c) => c.id === ownerChatId) : undefined
  if (!chat) return null
  if (isSketchChat(chat)) return { kind: "sketch", chatId: chat.id }
  if (!chat.branchId) return null
  const chatId =
    workspaceChatId(
      chats.map((c) => ({ ...c, createdAt: c.createdAt ?? 0 })),
      chat.branchId
    ) ?? chat.id
  return { kind: "workspace", chatId, branchId: chat.branchId }
}

/** {@link layerOwner} for each layer that has one, by layer id. */
export function layerOwners(
  layers: readonly Doc[],
  chats: readonly OwnerChat[]
): Map<string, LayerOwner> {
  const byChat = new Map<string, LayerOwner | null>()
  const out = new Map<string, LayerOwner>()
  for (const l of layers) {
    if (!l.ownerChatId) continue
    if (!byChat.has(l.ownerChatId)) {
      byChat.set(l.ownerChatId, layerOwner(l.ownerChatId, chats))
    }
    const owner = byChat.get(l.ownerChatId)
    if (owner) out.set(l.id, owner)
  }
  return out
}

/** The ids of the layers whose chat was deleted. */
export function orphanedLayerIds(
  layers: readonly Doc[],
  chats: readonly Pick<ChatSessionData, "id">[]
): Set<string> {
  return new Set(
    layers.filter((l) => isOrphaned(l.ownerChatId, chats)).map((l) => l.id)
  )
}

/**
 * The Workspace each chat-made Document or Mockup shows, by layer id: its
 * {@link layerOwner}'s Workspace. A layer made by hand, by a Sketch Chat, or
 * whose chat is gone has none.
 */
export function documentWorkspaceIds(
  documents: readonly Doc[],
  chats: readonly OwnerChat[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, owner] of layerOwners(documents, chats)) {
    if (owner.kind === "workspace") out.set(id, owner.branchId)
  }
  return out
}
