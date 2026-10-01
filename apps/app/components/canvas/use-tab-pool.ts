import { useCallback } from "react"
import { nanoid } from "nanoid"

import { useChatTabs } from "@/hooks/use-chat-tabs"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import type { TabPoolTarget } from "@/lib/chat/tab-pool"
import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { TerminalTabs } from "@/components/canvas/use-terminal-tabs"
import type { ChatSessionData } from "@/lib/types"

/**
 * Tab Pool controller (PRD #563) — the apply-side of a Chat Target's tab pool,
 * lifted out of `components/canvas/canvas.tsx`. The panel calls the verbs this
 * hook returns (`open`, `close`, `remove`,
 * `rename`, `reopen`, `seed`); the effects — the chat-store and Y.Doc tab
 * writes and the Terminal Tabs verbs — live here, in one place, rather than smeared across the Canvas surface. The
 * selection side effects each verb performs are delegated to the Chat-Target
 * controller (`useChatTarget`, #569), which owns *which* target is shown;
 * selecting a tab itself is now a Chat-Target verb (`selectChat`).
 *
 * The pure decision core stays in `lib/chat/tab-pool.ts`: `buildTabPool`
 * scopes the room-wide chats down to one Branch's pool and `resolveTabClose`
 * decides what survives, where selection lands, and whether to respawn. This controller is
 * the adapter that applies that outcome — "decide purely, apply at the call
 * site", with the call site now the controller rather than the component.
 *
 * The never-empty invariant ("while the target lives, its pool is never empty")
 * lives here too, with the writes that uphold it: a respawn recreates the
 * Workspace's chat so the panel is never left blank.
 *
 * The Chat Session half (open, close, remove, reopen, rename, the chat respawn)
 * and Chat Sync live in {@link useChatTabs}, which the player shares (#1261).
 * This controller composes it and adds what only the Canvas needs: Terminal
 * Tabs (opened, renamed and closed here, but outside the pool since #1341:
 * the Terminal Pane owns their selection), and Chat-Target selection.
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
  chatSessions: ChatSessionData[]
  /**
   * Terminal Tabs (#1265) — the one owner of this client's Terminal Tab list.
   * The Tab Pool changes it only through its verbs (`open`, `close`,
   * `rename`), the same way it composes Chat-Target for selection. Terminal Tabs are a distinct type, never in
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
  { kind: "chat"; branchId: string } | { kind: "terminal"; branchId: string }

export interface TabPool {
  /**
   * Create a new tab on a target and return its id. A chat is selected; a
   * terminal is left for the Terminal Pane to select.
   */
  open: (spec: OpenTabSpec) => string
  /**
   * Close a tab. A Chat Session is archived (`closedAt` stamped, reopenable); a
   * Terminal Tab is dropped and its backing tmux / PTY session killed. The
   * never-empty invariant respawns the target's default when its last chat
   * goes.
   */
  close: (chatId: string, nextSelectedId?: string) => void
  /** Permanently delete a Chat Session (or close a Terminal Tab). */
  remove: (chatId: string) => void
  /** Rename a Chat Session or Terminal Tab. */
  rename: (chatId: string, label: string) => void
  /** Restore a previously-closed Chat Session into its pool. */
  reopen: (chatId: string) => void
  /**
   * Seed a Branch's chat. The handoff Branch Intake (#562) calls so intake and
   * the Tab Pool agree on "the default tab". Selects the chat unless `select`
   * is false. Returns its id.
   */
  seed: (branchId: string, options?: { select?: boolean }) => string
}

export function useTabPool(deps: TabPoolDeps): TabPool {
  const {
    addChatSession,
    updateChatSession,
    removeChatSession,
    roomId,
    chatSessions,
    terminalTabs,
    chatTarget,
  } = deps
  const { isTerminal } = terminalTabs

  /**
   * Make sure an agent branch has its chat. This is the one place the "open a
   * fresh branch" and "the last tab was just closed" flows share. Selects the
   * chat unless `select` is false (branch-create defers selection to when the
   * sandbox is ready). Returns the chat's id.
   */
  const seed = useCallback(
    (branchId: string, options?: { select?: boolean }) => {
      const select = options?.select !== false
      // Every Workspace has its one chat from the start (#1315). Terminals
      // only open from the Terminal Pane's + (#1343).
      let chatId = workspaceChatId(chatSessions, branchId)
      if (!chatId) {
        chatId = nanoid()
        addChatSession(chatId, {
          id: chatId,
          branchId,
          label: "Untitled",
          createdAt: Date.now(),
        })
      }
      if (select) chatTarget.selectChatId(chatId)
      return chatId
    },
    [chatSessions, addChatSession, chatTarget]
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

  // An agent's respawn brings its chat back.
  const respawnAgent = useCallback(
    (branchId: string) => {
      seed(branchId)
    },
    [seed]
  )

  const {
    open: openChat,
    close: closeChat,
    remove: removeChat,
    rename: renameChat,
    reopen,
  } = useChatTabs({
    roomId,
    chatSessions,
    addChatSession,
    updateChatSession,
    removeChatSession,
    selectedChatId: chatTarget.selectedChatId,
    selectChat,
    respawnAgent,
  })

  // Close a Terminal Tab: it's ephemeral, so closing drops it (no closed-chats
  // archive), deletes its row and kills its session — all in Terminal Tabs.
  // Terminals aren't in the Tab Pool (#1341): the Terminal Pane moves its own
  // selection to the neighbour, and Dev server keeps it from ever emptying.
  const closeTerminal = useCallback(
    (id: string) => {
      terminalTabs.close(id)
    },
    [terminalTabs]
  )

  const open = useCallback(
    (spec: OpenTabSpec) => {
      if (spec.kind === "chat") {
        return openChat({ kind: "agent", branchId: spec.branchId })
      }
      // A Terminal Tab lives in Terminal Tabs — never in `chatSessions` — so
      // the Terminal Pane mounts a terminal body instead of the Engine chat and
      // the conversation model can never, by type, see it. It's a plain shell
      // (#1343). The pane selects it; the chat selection stays on the chat.
      return terminalTabs.open(spec.branchId).id
    },
    [openChat, terminalTabs]
  )

  const close = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      if (isTerminal(chatId)) closeTerminal(chatId)
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
