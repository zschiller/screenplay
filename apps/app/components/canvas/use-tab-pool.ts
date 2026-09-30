import { useCallback } from "react"
import { nanoid } from "nanoid"

import { useChatTabs } from "@/hooks/use-chat-tabs"
import {
  buildTabPool,
  resolveTabClose,
  type TabPoolTarget,
} from "@/lib/chat/tab-pool"
import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { TerminalTabs } from "@/components/canvas/use-terminal-tabs"
import {
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readLastTabKind,
} from "@/lib/canvas/tab-kind"
import type { ChatSessionData, TabKind } from "@/lib/types"

/**
 * Tab Pool controller (PRD #563) — the apply-side of a Chat Target's tab pool,
 * lifted out of `components/canvas/canvas.tsx`. The component renders the tab
 * strip and calls the verbs this hook returns (`open`, `close`, `remove`,
 * `rename`, `reopen`, `seed`); the effects — the chat-store and Y.Doc tab
 * writes and the Terminal Tabs verbs — live here, in one place, rather than smeared across the Canvas surface. The
 * selection side effects each verb performs are delegated to the Chat-Target
 * controller (`useChatTarget`, #569), which owns *which* target is shown;
 * selecting a tab itself is now a Chat-Target verb (`selectChat`).
 *
 * The pure decision core stays in `lib/chat/tab-pool.ts`: {@link buildTabPool}
 * scopes the room-wide lists down to one Branch's pool and {@link resolveTabClose} decides what
 * survives, where selection lands, and whether to respawn. This controller is
 * the adapter that applies that outcome — "decide purely, apply at the call
 * site", with the call site now the controller rather than the component.
 *
 * The never-empty invariant ("while the target lives, its pool is never empty")
 * lives here too, with the writes that uphold it: a respawn recreates the
 * target's preferred default tab so the panel is never left blank.
 *
 * The Chat Session half (open, close, remove, reopen, rename, the chat respawn)
 * and Chat Sync live in {@link useChatTabs}, which the player shares (#1261).
 * This controller composes it and adds what only the Canvas needs: Terminal
 * Tabs, the per-user default tab kind on an agent respawn, and Chat-Target
 * selection.
 *
 * Modelled on the Branch Intake controller (#562): plain injected seams, no
 * inline JSX handlers.
 */
export interface TabPoolDeps {
  /** Chat-session writers (thin wrappers over the Canvas Operation verbs). */
  addChatSession: (id: string, data: ChatSessionData) => void
  updateChatSession: (id: string, patch: Partial<ChatSessionData>) => void
  removeChatSession: (id: string) => void
  roomId: string
  /** The signed-in User's id, used to resolve the sticky harness pref (#290). */
  userId: string | undefined
  chatSessions: ChatSessionData[]
  /**
   * Terminal Tabs (#1265) — the one owner of this client's Terminal Tab list.
   * The Tab Pool reads the list for its pool decisions and changes it only
   * through its verbs (`open`, `close`, `rename`), the same way it composes
   * Chat-Target for selection. Terminal Tabs are a distinct type, never in
   * `chatSessions`.
   */
  terminalTabs: TerminalTabs
  /**
   * The Chat-Target controller (#569). The Tab Pool composes with it for the
   * selection side effects it used to perform by poking raw setters and memory
   * refs: it reads the current `selectedChatId` and calls the chat-target verbs
   * (`selectChatId`, `selectAgentChat`) to move selection.
   */
  chatTarget: ChatTarget
}

/**
 * What to open. A discriminated union so the component calls intent — a chat or
 * terminal tab on an agent Branch — rather than the effect sequence each kind
 * requires.
 */
export type OpenTabSpec =
  | { kind: "chat"; branchId: string }
  | { kind: "terminal"; branchId: string; harnessKey: string }

export interface TabPool {
  /** Create a new tab on a target and select it. */
  open: (spec: OpenTabSpec) => void
  /**
   * Close a tab. A Chat Session is archived (`closedAt` stamped, reopenable); a
   * Terminal Tab is dropped and its backing tmux / PTY session killed. The
   * never-empty invariant respawns the target's default when the last tab goes.
   */
  close: (chatId: string, nextSelectedId?: string) => void
  /** Permanently delete a Chat Session (or close a Terminal Tab). */
  remove: (chatId: string) => void
  /** Rename a Chat Session or Terminal Tab. */
  rename: (chatId: string, label: string) => void
  /** Restore a previously-closed Chat Session into its pool. */
  reopen: (chatId: string) => void
  /**
   * Seed a Branch's preferred default tab (chat or terminal). The handoff Branch
   * Intake (#562) calls so intake and the Tab Pool agree on "the default tab".
   * Selects the new tab unless `select` is false. Returns the new tab id.
   */
  seed: (
    branchId: string,
    kind: TabKind,
    options?: { select?: boolean }
  ) => string
}

export function useTabPool(deps: TabPoolDeps): TabPool {
  const {
    addChatSession,
    updateChatSession,
    removeChatSession,
    roomId,
    userId,
    chatSessions,
    terminalTabs,
    chatTarget,
  } = deps
  const { tabs: terminals, isTerminal } = terminalTabs

  /**
   * Create the user's preferred default tab (chat or terminal) for an agent
   * branch. This is the one place the "open a fresh branch" and "the last tab
   * was just closed" flows share, so the auto-created tab always follows the
   * per-user pref ({@link readLastTabKind}) rather than whatever kind happened
   * to be closed. Selects the new tab unless `select` is false (branch-create
   * defers selection to when the sandbox is ready). Returns the new tab id.
   */
  const seed = useCallback(
    (branchId: string, kind: TabKind, options?: { select?: boolean }) => {
      const select = options?.select !== false
      if (kind === "terminal") {
        // A terminal-default tab launches the same harness as the "+" button:
        // the operator's last-selected harness (#290), falling back to the
        // catalog default. If it's since been uninstalled the server resolves
        // it to a plain shell, so a stale pref degrades gracefully.
        const tab = terminalTabs.open(
          branchId,
          (userId ? readLastHarnessKey(userId) : null) ?? DEFAULT_HARNESS_KEY
        )
        if (select) chatTarget.selectChatId(tab.id)
        return tab.id
      }
      const id = nanoid()
      addChatSession(id, {
        id,
        branchId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      if (select) chatTarget.selectChatId(id)
      return id
    },
    [addChatSession, userId, terminalTabs, chatTarget]
  )

  const selectChat = useCallback(
    (chatId: string | null, target?: TabPoolTarget) => {
      if (chatId && target) {
        chatTarget.selectAgentChat(target.branchId, chatId)
      } else {
        chatTarget.selectChatId(chatId)
      }
    },
    [chatTarget]
  )

  // An agent's respawn follows the per-user default tab kind (chat or
  // terminal).
  const respawnAgent = useCallback(
    (branchId: string) => {
      seed(branchId, readLastTabKind())
    },
    [seed]
  )

  const {
    open: openChat,
    close: closeChat,
    remove: removeChat,
    rename: renameChat,
    reopen,
    applyCloseOutcome,
  } = useChatTabs({
    roomId,
    chatSessions,
    addChatSession,
    updateChatSession,
    removeChatSession,
    selectedChatId: chatTarget.selectedChatId,
    selectChat,
    terminals,
    respawnAgent,
  })

  // Close a Terminal Tab: it's ephemeral, so closing drops it (no closed-chats
  // archive), deletes its row and kills its session — all in Terminal Tabs.
  // The Tab Pool decision keeps the never-empty invariant — if this terminal is
  // the last tab on its branch (no sibling terminal and no open chat) it
  // returns a respawn for the user's preferred default kind (which may be a
  // chat); otherwise, if it was selected, it picks the fallback selection.
  const closeTerminal = useCallback(
    (id: string, nextSelectedId?: string) => {
      const closing = terminalTabs.close(id)
      if (closing) {
        const pool = buildTabPool(
          { kind: "agent", branchId: closing.branchId },
          chatSessions,
          terminals
        )
        const outcome = resolveTabClose(
          pool,
          id,
          chatTarget.selectedChatId,
          nextSelectedId
        )
        applyCloseOutcome(outcome)
      } else if (chatTarget.selectedChatId === id) {
        // No tab to form a pool around; just clear the selection if it was the
        // selected tab.
        chatTarget.selectChatId(nextSelectedId ?? null)
      }
    },
    [terminalTabs, terminals, chatSessions, chatTarget, applyCloseOutcome]
  )

  const open = useCallback(
    (spec: OpenTabSpec) => {
      if (spec.kind === "chat") {
        openChat({ kind: "agent", branchId: spec.branchId })
        return
      }
      // A Terminal Tab lives in Terminal Tabs — never in `chatSessions` — so
      // the panel mounts a terminal body instead of the Engine chat and the
      // conversation model can never, by type, see it.
      const tab = terminalTabs.open(spec.branchId, spec.harnessKey)
      chatTarget.selectAgentChat(spec.branchId, tab.id)
    },
    [openChat, terminalTabs, chatTarget]
  )

  const close = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      if (isTerminal(chatId)) closeTerminal(chatId, nextSelectedId)
      else closeChat(chatId, nextSelectedId)
    },
    [closeChat, isTerminal, closeTerminal]
  )

  const remove = useCallback(
    (chatId: string) => {
      if (isTerminal(chatId)) closeTerminal(chatId)
      else removeChat(chatId)
    },
    [removeChat, isTerminal, closeTerminal]
  )

  const rename = useCallback(
    (chatId: string, label: string) => {
      if (isTerminal(chatId)) terminalTabs.rename(chatId, label)
      else renameChat(chatId, label)
    },
    [renameChat, isTerminal, terminalTabs]
  )

  return { open, close, remove, rename, reopen, seed }
}
