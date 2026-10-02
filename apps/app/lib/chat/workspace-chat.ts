import type { ChatSessionData } from "@/lib/types"

/**
 * One chat per Workspace (#1315, spec #1308). A Branch has exactly one chat,
 * the one that made it, and that chat is the only one that changes its code.
 * The rule is the newest Chat Session on the Branch, closed or not: nothing
 * makes a second chat on a Branch any more, so the answer never moves. On a
 * canvas from before #1315 a Branch can hold several chats; the newest is the
 * one it continues in, and the rest are its **earlier chats**, kept readable
 * but never sent to.
 *
 * React-free and Yjs-free, so the panel, the prompt dispatch, the Coordinator's
 * delegation and the stream route all answer "which chat" the same way.
 */
export function workspaceChatId(
  chatSessions: readonly Pick<
    ChatSessionData,
    "id" | "branchId" | "createdAt"
  >[],
  branchId: string
): string | undefined {
  let newest: Pick<ChatSessionData, "id" | "createdAt"> | undefined
  for (const chat of chatSessions) {
    if (chat.branchId !== branchId) continue
    if (
      !newest ||
      chat.createdAt > newest.createdAt ||
      (chat.createdAt === newest.createdAt && chat.id > newest.id)
    ) {
      newest = chat
    }
  }
  return newest?.id
}

/**
 * Whether `chat` is one of its Branch's earlier chats: a Branch chat that isn't
 * the Workspace's chat. Only canvases from before #1315 have any.
 */
export function isEarlierChat(
  chatSessions: readonly Pick<
    ChatSessionData,
    "id" | "branchId" | "createdAt"
  >[],
  chat: Pick<ChatSessionData, "id" | "branchId">
): boolean {
  if (!chat.branchId) return false
  return workspaceChatId(chatSessions, chat.branchId) !== chat.id
}
