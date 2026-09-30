import type { ChatSessionData, MarkdownLayerData } from "@/lib/types"

/**
 * Who a Document belongs to (#1314): the chat that made it, recorded as its
 * `ownerChatId`. That chat alone edits it with its tools, its name shows on
 * it, and Send to agent and Reply in chat on it go there. A Document someone
 * made by hand has no owner. React-free, tested against plain values.
 */

type Doc = Pick<MarkdownLayerData, "id" | "ownerChatId">
type Chat = Pick<ChatSessionData, "id" | "branchId" | "closedAt">

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
 * The open chat that made a Document, and its Workspace: where its Send to
 * agent and Reply in chat go. Null for a Document made by hand, or whose chat
 * is closed or gone; those go to the chat on screen instead.
 */
export function documentOwnerChat(
  documentId: string,
  documents: readonly Doc[],
  chats: readonly Chat[]
): { chatId: string; branchId: string } | null {
  const ownerChatId = documents.find((d) => d.id === documentId)?.ownerChatId
  const chat = ownerChatId ? chats.find((c) => c.id === ownerChatId) : undefined
  if (!chat?.branchId || chat.closedAt) return null
  return { chatId: chat.id, branchId: chat.branchId }
}
