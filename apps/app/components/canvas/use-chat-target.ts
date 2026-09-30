import { type RefObject, useCallback, useRef, useState } from "react"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { isRoomChatId } from "@/lib/chat/room-chat"
import {
  pendingProbes,
  resolveChatPanelTarget,
  type ChatPanelTarget,
  resolvePendingReady,
  restoreAgentChatSelection,
  type PendingProbe,
} from "@/lib/chat/chat-target"
import type { BranchData, ChatSessionData, TerminalTabData } from "@/lib/types"

/**
 * Chat-Target selection controller (PRD #569) — the apply-side of *which* Chat
 * Target the agent panel shows, lifted out of `components/canvas/canvas.tsx`. It
 * is the symmetric sibling of the Tab Pool controller (`useTabPool`, #563):
 * target selection + tab pool = the panel model. This hook owns the selection
 * state (`selectedAgentId`, `selectedChatId`, `pendingAgentIds`), the per-target
 * memory (last chat per agent, last agent per repo), and the pending-agent
 * readiness; it exposes the resolved `target` and a small set of selection
 * verbs.
 *
 * The pure decisions stay in `lib/chat/chat-target.ts`: the `ChatPanelTarget`
 * resolution, the remembered-chat restoration rule, and the pending-agent
 * readiness transitions. This controller is the adapter that applies them —
 * "decide purely, apply at the call site" — and the call site for the selection
 * side effects the Tab Pool and Branch Intake controllers used to perform by
 * poking raw setters. They now depend on this controller's interface instead.
 *
 * Panel-expand-on-select lives here: it is a target-selection side effect, so it
 * travels with the verb that selects.
 */
export interface ChatTargetDeps {
  agents: BranchData[]
  chatSessions: ChatSessionData[]
  /** This client's local Terminal Tabs — needed to resolve a selected tab's target. */
  localTerminals: TerminalTabData[]
  chatPanelRef: RefObject<PanelImperativeHandle | null>
}

export interface ChatTarget {
  /** The resolved panel target — an agent (sandbox-backed), else null. */
  target: ChatPanelTarget | null
  /** The selected agent record, or undefined when nothing is targeted. */
  selectedAgent: BranchData | undefined
  selectedAgentId: string | null
  selectedChatId: string | null
  /** The pending agents currently worth probing (one LogProbe rendered each). */
  pendingProbes: PendingProbe[]

  /**
   * Point the panel at an agent: save the outgoing agent's chat, remember the
   * repo's agent, restore the remembered chat (or the first open one), and
   * expand the panel.
   */
  selectAgent: (
    agentId: string | null,
    options?: { expandPanel?: boolean }
  ) => void
  /**
   * Return the panel to its home, the Coordinator chat: clear the selected
   * Workspace (the "Coordinator" crumb does this).
   */
  showRoomChat: () => void
  /** Select a specific tab, tracking its agent and remembering it. */
  selectChat: (chatId: string | null) => void
  /** Point the panel at an agent and a specific chat/terminal on it. */
  selectAgentChat: (
    branchId: string,
    chatId: string,
    options?: {
      expandPanel?: boolean
      remember?: boolean
    }
  ) => void
  /** Move selection to a chat id without re-resolving its target. */
  selectChatId: (chatId: string | null) => void
  /** Clear selection + collapse the panel when the given agent was selected. */
  clearIfSelected: (agentId: string) => void
  /** The chat last selected for an agent (the remembered-chat memory). */
  rememberedAgentChatId: (agentId: string) => string | undefined

  /** Add agents to the pending-readiness set (deduped). */
  addPending: (ids: string[]) => void
  /** A pending agent's sandbox is streaming logs: select it, drop it from pending. */
  handlePendingReady: (id: string) => void

  /** Expand (and minimally size) the collapsed chat panel. */
  expandPanel: () => void
}

export function useChatTarget(deps: ChatTargetDeps): ChatTarget {
  const { agents, chatSessions, localTerminals, chatPanelRef } = deps

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  // Agents created this session whose sandbox isn't streaming logs yet. A
  // LogProbe is rendered for each (see `pendingProbes`); on ready we flip
  // selection and drop the id.
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([])

  // Per-repo / per-agent memory so switching back restores the prior
  // selection.
  const selectedAgentByRepoRef = useRef<Record<string, string>>({})
  const selectedChatByAgentRef = useRef<Record<string, string>>({})

  const expandPanel = useCallback(() => {
    const panel = chatPanelRef.current
    if (panel?.isCollapsed()) {
      panel.expand()
      const { inPixels } = panel.getSize()
      if (inPixels < 480) panel.resize(480)
    }
  }, [chatPanelRef])

  const selectAgent = useCallback(
    (agentId: string | null, options?: { expandPanel?: boolean }) => {
      if (!agentId) return

      // Save the outgoing agent's chat selection.
      if (selectedAgentId && selectedChatId) {
        selectedChatByAgentRef.current[selectedAgentId] = selectedChatId
      }

      // Remember this agent as its repo's last-selected.
      const agent = agents.find((a) => a.id === agentId)
      if (agent) selectedAgentByRepoRef.current[agent.repoId] = agentId

      setSelectedAgentId(agentId)

      // Restore the remembered chat if still open, else the first open one.
      const remembered = selectedChatByAgentRef.current[agentId]
      setSelectedChatId(
        restoreAgentChatSelection(chatSessions, agentId, remembered)
      )

      if (options?.expandPanel !== false) expandPanel()
    },
    [agents, chatSessions, selectedAgentId, selectedChatId, expandPanel]
  )

  const showRoomChat = useCallback(() => {
    if (selectedAgentId && selectedChatId) {
      selectedChatByAgentRef.current[selectedAgentId] = selectedChatId
    }
    setSelectedAgentId(null)
    setSelectedChatId(null)
  }, [selectedAgentId, selectedChatId])

  const selectChat = useCallback(
    (chatId: string | null) => {
      if (chatId && isRoomChatId(chatId)) {
        showRoomChat()
        return
      }
      setSelectedChatId(chatId)
      if (chatId) {
        const terminal = localTerminals.find((t) => t.id === chatId)
        if (terminal) {
          // Local terminals aren't in the Y.Doc; just track their branch so the
          // agent target stays selected. No per-target "remember" ref — they
          // don't survive a remount anyway.
          if (terminal.branchId) setSelectedAgentId(terminal.branchId)
          return
        }
        const chat = chatSessions.find((c) => c.id === chatId)
        if (!chat) return
        if (chat.branchId) {
          setSelectedAgentId(chat.branchId)
          selectedChatByAgentRef.current[chat.branchId] = chatId
        }
      }
    },
    [chatSessions, localTerminals, showRoomChat]
  )

  const selectAgentChat = useCallback(
    (
      branchId: string,
      chatId: string,
      options?: {
        expandPanel?: boolean
        remember?: boolean
      }
    ) => {
      setSelectedAgentId(branchId)
      setSelectedChatId(chatId)
      if (options?.remember) selectedChatByAgentRef.current[branchId] = chatId
      if (options?.expandPanel) expandPanel()
    },
    [expandPanel]
  )

  const selectChatId = useCallback((chatId: string | null) => {
    setSelectedChatId(chatId)
  }, [])

  const clearIfSelected = useCallback(
    (agentId: string) => {
      if (selectedAgentId !== agentId) return
      setSelectedAgentId(null)
      setSelectedChatId(null)
      chatPanelRef.current?.collapse()
    },
    [selectedAgentId, chatPanelRef]
  )

  const rememberedAgentChatId = useCallback(
    (agentId: string) => selectedChatByAgentRef.current[agentId],
    []
  )

  const addPending = useCallback((ids: string[]) => {
    setPendingAgentIds((prev) => {
      const additions = ids.filter((id) => !prev.includes(id))
      return additions.length > 0 ? [...prev, ...additions] : prev
    })
  }, [])

  const handlePendingReady = useCallback((id: string) => {
    setSelectedAgentId(id)
    setPendingAgentIds((prev) => resolvePendingReady(prev, id).pendingAgentIds)
  }, [])

  // No Workspace is picked for you: with nothing selected the panel shows its
  // home, the Coordinator chat (#893). A just-created agent is still selected
  // once its sandbox streams logs (see `handlePendingReady`).

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const target = resolveChatPanelTarget(selectedAgent)

  return {
    target,
    selectedAgent,
    selectedAgentId,
    selectedChatId,
    pendingProbes: pendingProbes(pendingAgentIds, agents),
    selectAgent,
    showRoomChat,
    selectChat,
    selectAgentChat,
    selectChatId,
    clearIfSelected,
    rememberedAgentChatId,
    addPending,
    handlePendingReady,
    expandPanel,
  }
}
