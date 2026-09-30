import { useCallback } from "react"
import { nanoid } from "nanoid"

import { chatStore } from "@/lib/chat-store"
import {
  buildTabPool,
  resolveTabClose,
  type TabCloseOutcome,
  type TabPoolTarget,
} from "@/lib/chat/tab-pool"
import { useChatSync } from "@/hooks/use-chat-sync"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import type { ChatSessionData, TerminalTabData } from "@/lib/types"

/**
 * Chat tabs (#1261, spec #1249) — the Chat Session half of the Tab Pool plus
 * Chat Sync, shared by the Canvas and the player. The player never mounts the
 * Canvas, so this is the one module both hosts use: open, close, remove,
 * reopen and rename a Chat Session, with every close and remove going through
 * the pure {@link resolveTabClose} rule (the never-empty respawn included), and
 * the Chat Sync effects (history, stream start / end, heal) over the same
 * `chatSessions`. A fix here reaches both at once.
 *
 * The player hands it one Branch's Chat Sessions and its own selection state.
 * The Canvas hands it the whole room's list and composes it inside
 * `useTabPool`, which adds what only the Canvas needs: Terminal Tabs (passed
 * here as `terminals` so they count toward the pool), the per-user default tab
 * kind for an agent respawn (`respawnAgent`), and Chat-Target selection
 * (`selectChat`'s `target`).
 */
export interface ChatTabsDeps {
  roomId: string
  /** Live Chat Sessions from the synced Y.Doc (the pools are built from these). */
  chatSessions: ChatSessionData[]
  /** Chat-session writers (thin wrappers over the Chat Session collection). */
  addChatSession: (id: string, data: ChatSessionData) => void
  updateChatSession: (id: string, patch: Partial<ChatSessionData>) => void
  removeChatSession: (id: string) => void
  selectedChatId: string | null
  /**
   * Move selection. `target` is set when the chat was just created on it, so a
   * host that tracks the shown target (the Canvas's Chat-Target) can follow.
   */
  selectChat: (chatId: string | null, target?: TabPoolTarget) => void
  /** Open non-chat tabs that share an agent's pool (the Canvas's Terminal Tabs). */
  terminals?: TerminalTabData[]
  /**
   * Recreate an agent's default tab when its last one goes. Defaults to a fresh
   * chat; the Canvas passes its per-user default tab kind (chat or terminal).
   */
  respawnAgent?: (branchId: string) => void
}

export interface ChatTabs {
  /**
   * Bring up a target's chat and select it. Returns its id. A Workspace has one
   * chat (#1315): its own chat when it has one, reopened if it was closed; a
   * fresh one only for a Workspace without any.
   */
  open: (target: TabPoolTarget) => string
  /** Archive a chat (`closedAt` stamped, reopenable). */
  close: (chatId: string, nextSelectedId?: string) => void
  /** Permanently delete a chat. */
  remove: (chatId: string) => void
  /** Restore a closed chat into its pool and select it. */
  reopen: (chatId: string) => void
  rename: (chatId: string, label: string) => void
  /**
   * Apply a {@link resolveTabClose} outcome: respawn the target's default tab,
   * or move selection. Exposed so the Canvas's Terminal Tab close lands on the
   * same respawn and selection.
   */
  applyCloseOutcome: (outcome: TabCloseOutcome) => void
}

const NO_TERMINALS: TerminalTabData[] = []

export function useChatTabs(deps: ChatTabsDeps): ChatTabs {
  const {
    roomId,
    chatSessions,
    addChatSession,
    updateChatSession,
    removeChatSession,
    selectedChatId,
    selectChat,
    terminals = NO_TERMINALS,
    respawnAgent,
  } = deps

  useChatSync({ chatSessions, roomId, updateChatSession })

  const open = useCallback(
    (target: TabPoolTarget) => {
      const own = workspaceChatId(chatSessions, target.branchId)
      if (own) {
        if (chatSessions.find((c) => c.id === own)?.closedAt) {
          updateChatSession(own, { closedAt: 0 })
        }
        selectChat(own, target)
        return own
      }
      const id = nanoid()
      addChatSession(id, {
        id,
        branchId: target.branchId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      selectChat(id, target)
      return id
    },
    [chatSessions, addChatSession, updateChatSession, selectChat]
  )

  // With no respawn, selection moves only when the decision says so
  // (`nextSelectedId` set); an omitted value leaves it in place.
  const applyCloseOutcome = useCallback(
    (outcome: TabCloseOutcome) => {
      const { respawn, nextSelectedId } = outcome
      if (respawn) {
        if (respawnAgent) respawnAgent(respawn.branchId)
        else open({ kind: "agent", branchId: respawn.branchId })
        return
      }
      if (nextSelectedId !== undefined) selectChat(nextSelectedId)
    },
    [respawnAgent, open, selectChat]
  )

  // Resolve a chat's pool (its Branch's, from buildTabPool) and apply the pure
  // decision. A chat that is already closed isn't in its pool (removing it
  // from the history menu decides nothing), and a chat with no Branch has no
  // pool; both return false and leave selection.
  const resolveChatClose = useCallback(
    (chatId: string, nextSelectedId?: string): boolean => {
      const chat = chatSessions.find((c) => c.id === chatId)
      if (!chat || chat.closedAt) return false
      if (!chat.branchId) return false
      const target: TabPoolTarget = { kind: "agent", branchId: chat.branchId }
      const pool = buildTabPool(target, chatSessions, terminals)
      applyCloseOutcome(
        resolveTabClose(pool, chatId, selectedChatId, nextSelectedId)
      )
      return true
    },
    [chatSessions, terminals, selectedChatId, applyCloseOutcome]
  )

  // A Workspace's own chat never closes or goes (#1315); only its earlier
  // chats do.
  const close = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      if (isOwnChat(chatSessions, chatId)) return
      updateChatSession(chatId, { closedAt: Date.now() })
      resolveChatClose(chatId, nextSelectedId)
    },
    [chatSessions, updateChatSession, resolveChatClose]
  )

  const remove = useCallback(
    (chatId: string) => {
      if (isOwnChat(chatSessions, chatId)) return
      // A deleted chat can't stay selected, even when it had no pool to decide.
      if (!resolveChatClose(chatId) && selectedChatId === chatId) {
        selectChat(null)
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [
      chatSessions,
      resolveChatClose,
      selectedChatId,
      selectChat,
      removeChatSession,
    ]
  )

  const reopen = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
      selectChat(chatId)
    },
    [updateChatSession, selectChat]
  )

  const rename = useCallback(
    (chatId: string, label: string) => {
      updateChatSession(chatId, { label })
    },
    [updateChatSession]
  )

  return { open, close, remove, reopen, rename, applyCloseOutcome }
}

/** Whether `chatId` is its Workspace's one chat (#1315). */
function isOwnChat(
  chatSessions: readonly ChatSessionData[],
  chatId: string
): boolean {
  const branchId = chatSessions.find((c) => c.id === chatId)?.branchId
  return !!branchId && workspaceChatId(chatSessions, branchId) === chatId
}
