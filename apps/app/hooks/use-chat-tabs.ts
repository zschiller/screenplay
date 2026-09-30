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
  /** Create a fresh chat on a target and select it. Returns its id. */
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
      const id = nanoid()
      addChatSession(id, {
        id,
        ...(target.kind === "agent"
          ? { branchId: target.branchId }
          : { markdownLayerId: target.markdownLayerId }),
        label: "Untitled",
        createdAt: Date.now(),
      })
      selectChat(id, target)
      return id
    },
    [addChatSession, selectChat]
  )

  // With no respawn, selection moves only when the decision says so
  // (`nextSelectedId` set); an omitted value leaves it in place.
  const applyCloseOutcome = useCallback(
    (outcome: TabCloseOutcome) => {
      const { respawn, nextSelectedId } = outcome
      if (respawn) {
        if (respawn.target === "agent") {
          if (respawnAgent) respawnAgent(respawn.branchId)
          else open({ kind: "agent", branchId: respawn.branchId })
        } else {
          open({ kind: "doc", markdownLayerId: respawn.markdownLayerId })
        }
        return
      }
      if (nextSelectedId !== undefined) selectChat(nextSelectedId)
    },
    [respawnAgent, open, selectChat]
  )

  // Resolve a chat's pool (agent vs doc, kept apart in buildTabPool) and apply
  // the pure decision. A chat that is already closed isn't in its pool
  // (removing it from the history menu decides nothing), and a chat with no
  // agent or doc target has no pool; both return false and leave selection.
  const resolveChatClose = useCallback(
    (chatId: string, nextSelectedId?: string): boolean => {
      const chat = chatSessions.find((c) => c.id === chatId)
      if (!chat || chat.closedAt) return false
      const target: TabPoolTarget | null = chat.branchId
        ? { kind: "agent", branchId: chat.branchId }
        : chat.markdownLayerId
          ? { kind: "doc", markdownLayerId: chat.markdownLayerId }
          : null
      if (!target) return false
      const pool = buildTabPool(target, chatSessions, terminals)
      applyCloseOutcome(
        resolveTabClose(pool, chatId, selectedChatId, nextSelectedId)
      )
      return true
    },
    [chatSessions, terminals, selectedChatId, applyCloseOutcome]
  )

  const close = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      updateChatSession(chatId, { closedAt: Date.now() })
      resolveChatClose(chatId, nextSelectedId)
    },
    [updateChatSession, resolveChatClose]
  )

  const remove = useCallback(
    (chatId: string) => {
      // A deleted chat can't stay selected, even when it had no pool to decide.
      if (!resolveChatClose(chatId) && selectedChatId === chatId) {
        selectChat(null)
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [resolveChatClose, selectedChatId, selectChat, removeChatSession]
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
