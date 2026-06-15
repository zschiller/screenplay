import { chatStore, type SendMessageOptions } from "@/lib/chat-store"
import { restoreAgentChatSelection } from "@/lib/chat/chat-target"
import type { BranchData, ChatSessionData } from "@/lib/types"

/**
 * Agent-prompt dispatch — the single seam every "send a turn to an agent's
 * chat" path runs through (`apps/app/CONTEXT.md`, "Chat Session",
 * "Chat Target"). It is the sibling of `lib/chat/chat-target` and
 * `lib/chat/tab-pool`, and mirrors `lib/canvas/chat-reference` exactly: a
 * React-free / Yjs-free **pure decision** ({@link resolveTargetChat}) plus a
 * thin **apply verb** ({@link dispatchPrompt}) the controllers call.
 *
 * Before this module the choreography — resolve which chat to use, create or
 * reuse the Chat Session, select the target, call `chatStore.sendMessage` with
 * the rename callbacks wired — was open-coded in three places
 * (`handleRebaseOnDefault`, `useElementReference.sendReference`, and
 * `useBranchIntake`'s seed send), so the remembered-chat / first-open /
 * busy-bumps-to-a-fresh-chat rule had no home and each copy could drift.
 *
 * Two pieces:
 *
 * 1. {@link resolveTargetChat} — the pure decision "which Chat Session should
 *    this prompt land in" for an agent target: reuse the remembered chat if it
 *    is still open, else the agent's first open chat; a busy (already streaming)
 *    target bumps to a fresh chat, as does an agent with no open chat; a missing
 *    branch / sandbox yields "none". Returns the {@link ReferenceDecision}-shaped
 *    result the codebase already uses for `chat-reference`, with `session: null`
 *    marking a reused chat (nothing to create).
 * 2. {@link dispatchPrompt} — the apply verb. Create the Chat Session through the
 *    canvas ops seam (ADR 0001) *only* when the decision calls for a fresh chat;
 *    select the resolved target through the Chat-Target controller; call
 *    `chatStore.sendMessage` with `onBranchRename` / `onChatRename` wired.
 */

/** Which Chat Target a prompt lands on — drives selection and rename wiring. */
export type PromptTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "document"; documentId: string }

/**
 * A resolved prompt ready to apply. {@link dispatchPrompt} consumes it; the
 * `chat-reference` decision and {@link resolveTargetChat} both produce one.
 */
export interface PromptDispatch {
  /**
   * The Chat Session to create through the ops seam, or `null` to reuse an
   * already-open chat (the remembered-chat path, or a session created earlier —
   * Branch Intake's seed chat already exists when its prompt fires).
   */
  session: ChatSessionData | null
  /** The target this prompt lands on. */
  target: PromptTarget
  /**
   * Whether (and how) to select the target through the Chat-Target controller.
   * `false` skips selection entirely — Branch Intake's seed defers selection to
   * the pending-ready flow, so its dispatch must not reach in and select.
   */
  select: false | { clearDocument?: boolean; remember?: boolean }
  /** Expand the chat panel after dispatching (a target-selection side effect). */
  expandPanel: boolean
  /** The `sendMessage` arguments; the rename callbacks are wired by the verb. */
  send: Omit<SendMessageOptions, "onBranchRename" | "onChatRename">
}

/** The Chat-Target controller verbs the dispatch applies (structural). */
export interface PromptChatTarget {
  selectAgentChat: (
    branchId: string,
    chatId: string,
    options?: { expandPanel?: boolean; clearDocument?: boolean; remember?: boolean }
  ) => void
  selectDocChat: (
    markdownLayerId: string,
    chatId: string,
    options?: { expandPanel?: boolean }
  ) => void
  expandPanel: () => void
}

/** The injected seams {@link dispatchPrompt} applies its decision over. */
export interface DispatchPromptDeps {
  /** Create a Chat Session through the canvas ops seam (ADR 0001). */
  addChatSession: (id: string, data: ChatSessionData) => void
  /** Selection goes through the Chat-Target controller, not raw setters. */
  chatTarget: PromptChatTarget
  /** Late-bound rename callbacks fired by the chat stream (auto-naming). */
  onChatRename: (chatId: string, label: string) => void
  onBranchRename: (agentId: string, branch: string) => void
}

/**
 * Apply a resolved {@link PromptDispatch}: create the fresh Chat Session when
 * one is called for, select the target through the Chat-Target controller, and
 * send the message with the rename callbacks wired. The single apply path the
 * Element Reference, Branch Intake, and Branch Actions controllers share.
 */
export function dispatchPrompt(
  dispatch: PromptDispatch,
  deps: DispatchPromptDeps
): void {
  const { session, target, select, expandPanel, send } = dispatch

  if (session) deps.addChatSession(session.id, session)

  if (select !== false) {
    if (target.kind === "agent") {
      deps.chatTarget.selectAgentChat(target.agentId, send.chatId, {
        clearDocument: select.clearDocument,
        remember: select.remember,
      })
    } else {
      deps.chatTarget.selectDocChat(target.documentId, send.chatId)
    }
  }

  if (target.kind === "agent") {
    chatStore.sendMessage({
      ...send,
      onBranchRename: (branch) => deps.onBranchRename(target.agentId, branch),
      onChatRename: (label) => deps.onChatRename(send.chatId, label),
    })
  } else {
    chatStore.sendMessage({
      ...send,
      onChatRename: (label) => deps.onChatRename(send.chatId, label),
    })
  }

  if (expandPanel) deps.chatTarget.expandPanel()
}

/** The resolved-target decision — {@link ReferenceDecision}'s agent shape, with
 *  `session: null` distinguishing a reused chat from a fresh one. */
export type TargetChatDecision =
  | { kind: "none" }
  | {
      kind: "send"
      /** The Chat Session to create, or `null` when an open chat is reused. */
      session: ChatSessionData | null
      isFirstChat: boolean
      select: { kind: "agent"; agentId: string; chatId: string }
      send: Omit<SendMessageOptions, "onBranchRename" | "onChatRename">
    }

export interface ResolveTargetChatInput {
  /** Plain runtime values injected so the decision stays deterministic. */
  roomId: string
  /** A freshly-minted id to use when a new chat is needed. */
  freshChatId: string
  createdAt: number
  message: string
  /** The agent the prompt targets. */
  agent: Pick<BranchData, "id" | "sandboxName" | "ref" | "autoNamedBranch">
  /** All Chat Sessions — filtered to the agent's open chats internally. */
  chatSessions: readonly ChatSessionData[]
  /** The remembered chat id from the Chat-Target controller. */
  rememberedChatId: string | null | undefined
  /**
   * Whether a chat is mid-turn (streaming). Injected so the core stays pure —
   * the controller combines the live chat-store snapshot with the Y.Doc mirror.
   */
  isBusy: (chatId: string) => boolean
}

/**
 * Resolve which Chat Session a prompt to an agent should land in. Reuses the
 * remembered chat when it is still open (else the agent's first open chat); a
 * busy target — or no open chat at all — bumps to a fresh Chat Session. A
 * reused chat carries its own plan-mode / model forward. An agent with no
 * Sandbox / branch yields `{ kind: "none" }`.
 */
export function resolveTargetChat(
  input: ResolveTargetChatInput
): TargetChatDecision {
  const {
    roomId,
    freshChatId,
    createdAt,
    message,
    agent,
    chatSessions,
    rememberedChatId,
    isBusy,
  } = input

  if (!agent.sandboxName || !agent.ref) return { kind: "none" }

  // The remembered-chat rule, shared with the Chat-Target controller: the
  // remembered chat if still open, else the first open one, else none.
  const restoredId = restoreAgentChatSelection(
    chatSessions,
    agent.id,
    rememberedChatId
  )
  const targetChat = restoredId
    ? chatSessions.find((c) => c.id === restoredId)
    : undefined
  const busy = targetChat ? isBusy(targetChat.id) : false

  // A busy target (mid-turn) — or no open chat at all — bumps to a fresh chat so
  // an in-flight turn is never interrupted; otherwise reuse the chat and carry
  // its plan-mode / model forward.
  let session: ChatSessionData | null
  let chatId: string
  let planMode: boolean | undefined
  let model: string | undefined
  if (!targetChat || busy) {
    chatId = freshChatId
    session = {
      id: chatId,
      branchId: agent.id,
      label: "Untitled",
      createdAt,
    }
  } else {
    chatId = targetChat.id
    session = null
    planMode = targetChat.planMode
    model = targetChat.model
  }

  const isFirstChat = !chatSessions.some(
    (c) => c.branchId === agent.id && c.id !== chatId
  )

  return {
    kind: "send",
    session,
    isFirstChat,
    select: { kind: "agent", agentId: agent.id, chatId },
    send: {
      roomId,
      chatId,
      sandboxName: agent.sandboxName,
      branch: agent.ref,
      message,
      isFirstChat,
      autoNamedBranch: agent.autoNamedBranch,
      planMode,
      model,
    },
  }
}
