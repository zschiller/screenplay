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
type Chat = Pick<ChatSessionData, "id" | "branchId">

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

/**
 * The Workspace each chat-made Document shows: its owning chat's Workspace,
 * by Document id. A Document made by hand, or whose chat is gone, has none.
 */
export function documentWorkspaceIds(
  documents: readonly Doc[],
  chats: readonly Chat[]
): Map<string, string> {
  const chatBranch = new Map(
    chats.flatMap((c) => (c.branchId ? [[c.id, c.branchId] as const] : []))
  )
  const out = new Map<string, string>()
  for (const d of documents) {
    const branchId = d.ownerChatId ? chatBranch.get(d.ownerChatId) : undefined
    if (branchId) out.set(d.id, branchId)
  }
  return out
}

/**
 * The chat a Document goes back to, and its Workspace: where its Send to agent
 * and Reply in chat go. That is the Workspace chat of the chat that made it
 * (#1315), the same chat unless it was made in one of the Workspace's earlier
 * chats. Null for a Document made by hand, or whose chat is gone; those go to
 * the chat on screen instead.
 */
export function documentOwnerChat(
  documentId: string,
  documents: readonly Doc[],
  chats: readonly (Chat & Pick<ChatSessionData, "createdAt">)[]
): { chatId: string; branchId: string } | null {
  const ownerChatId = documents.find((d) => d.id === documentId)?.ownerChatId
  const chat = ownerChatId ? chats.find((c) => c.id === ownerChatId) : undefined
  if (!chat?.branchId) return null
  const chatId = workspaceChatId(chats, chat.branchId) ?? chat.id
  return { chatId, branchId: chat.branchId }
}

/**
 * Where a Mockup's empty Knobs popover sends "Ask the agent to add a knob", by
 * Mockup id: the Sketch Chat that made it, or the Workspace chat of the chat
 * that made it (#1315, the same resolution as {@link documentOwnerChat}), never
 * an earlier, read-only chat. A Mockup whose chat was deleted goes to whichever
 * chat the panel shows (`shown`), which claims it by editing it. A Mockup made
 * by hand has none and offers no Ask.
 */
export type MockupAskTarget =
  | { kind: "sketch"; chatId: string }
  | { kind: "workspace"; chatId: string; branchId: string }
  | { kind: "shown" }

export function mockupAskTargets(
  mockups: readonly Doc[],
  chats: readonly (Chat & Pick<ChatSessionData, "createdAt" | "target">)[]
): Map<string, MockupAskTarget> {
  const out = new Map<string, MockupAskTarget>()
  for (const m of mockups) {
    if (!m.ownerChatId) continue
    const chat = chats.find((c) => c.id === m.ownerChatId)
    if (!chat) {
      out.set(m.id, { kind: "shown" })
      continue
    }
    if (isSketchChat(chat)) {
      out.set(m.id, { kind: "sketch", chatId: chat.id })
    } else if (chat.branchId) {
      const chatId = workspaceChatId(chats, chat.branchId) ?? chat.id
      out.set(m.id, { kind: "workspace", chatId, branchId: chat.branchId })
    }
  }
  return out
}
