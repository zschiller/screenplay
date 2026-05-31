import type { ChatSessionData, TabKind } from "@/lib/types"

/**
 * The kind of a tab. Absent `kind` reads as `"chat"` so legacy chat-tab data
 * — written before the discriminant existed — keeps working unchanged.
 */
export function tabKind(session: Pick<ChatSessionData, "kind">): TabKind {
  return session.kind ?? "chat"
}

/** Whether `session` is a terminal tab (BYO-harness, ephemeral). */
export function isTerminalTab(session: Pick<ChatSessionData, "kind">): boolean {
  return tabKind(session) === "terminal"
}

/**
 * Whether a tab's scrollback participates in the durable conversation model
 * (chat-store, Postgres history, Y.Doc broadcast). True only for chat tabs;
 * terminal tabs are ephemeral by construction, so the conversation entry
 * points consult this to guarantee terminal scrollback is never persisted.
 */
export function persistsConversation(session: Pick<ChatSessionData, "kind">): boolean {
  return tabKind(session) === "chat"
}

/** Default label for a freshly-created terminal tab. */
export const TERMINAL_TAB_LABEL = "Terminal"

/**
 * Build the `ChatSessionData` for a new terminal tab against `branchId`'s
 * sandbox. The tab's own `id` doubles as its `terminalSessionId` — the shared
 * live-view key — so a second client opening the same tab co-views one PTY.
 * It carries no `markdownLayerId`: a terminal tab is never a conversation.
 */
export function createTerminalTab(input: {
  id: string
  branchId: string
  createdAt: number
  label?: string
}): ChatSessionData {
  return {
    id: input.id,
    kind: "terminal",
    branchId: input.branchId,
    terminalSessionId: input.id,
    label: input.label ?? TERMINAL_TAB_LABEL,
    createdAt: input.createdAt,
  }
}
