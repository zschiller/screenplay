import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { type PanelImperativeHandle } from "react-resizable-panels"

import type { ChatPanelTarget } from "@/components/agent/chat-panel"
import {
  pendingProbes,
  resolveChatPanelTarget,
  resolvePendingReady,
  restoreAgentChatSelection,
  type PendingProbe,
} from "@/lib/chat/chat-target"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
  TerminalTabData,
} from "@/lib/types"

/**
 * Chat-Target selection controller (PRD #569) — the apply-side of *which* Chat
 * Target the agent panel shows, lifted out of `components/canvas/canvas.tsx`. It
 * is the symmetric sibling of the Tab Pool controller (`useTabPool`, #563):
 * target selection + tab pool = the panel model. This hook owns the selection
 * state (`selectedAgentId`, `selectedDocumentChatTargetId`, `selectedChatId`,
 * `pendingAgentIds`), the per-target memory (last chat per agent / per document,
 * last agent per repo), and the pending-agent readiness; it exposes the resolved
 * `target` and a small set of selection verbs.
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
  markdownLayers: MarkdownLayerData[]
  /** This client's local Terminal Tabs — needed to resolve a selected tab's target. */
  localTerminals: TerminalTabData[]
  chatPanelRef: RefObject<PanelImperativeHandle | null>
}

export interface ChatTarget {
  /** The resolved panel target — an agent (sandbox-backed) or a layer, else null. */
  target: ChatPanelTarget | null
  /** The selected agent record, or undefined when a doc / nothing is targeted. */
  selectedAgent: BranchData | undefined
  selectedAgentId: string | null
  selectedDocumentChatTargetId: string | null
  selectedChatId: string | null
  /** The pending agents currently worth probing (one LogProbe rendered each). */
  pendingProbes: PendingProbe[]

  /**
   * Point the panel at an agent: save the outgoing agent's chat, remember the
   * repo's agent, restore the remembered chat (or the first open one), and
   * expand the panel. `clearDocument` clears any picked doc target (the panel's
   * target dropdown does this; the sidebar leaves it latent, agent-wins).
   */
  selectAgent: (
    agentId: string | null,
    options?: { expandPanel?: boolean; clearDocument?: boolean }
  ) => void
  /** Point the panel at a document target, restoring its last open chat. */
  selectDocument: (markdownLayerId: string) => void
  /** Select a specific tab, tracking its target (agent/doc) and remembering it. */
  selectChat: (chatId: string | null) => void
  /** Point the panel at an agent and a specific chat/terminal on it. */
  selectAgentChat: (
    branchId: string,
    chatId: string,
    options?: {
      expandPanel?: boolean
      clearDocument?: boolean
      remember?: boolean
    }
  ) => void
  /** Point the panel at a document and a specific chat on it (remembers it). */
  selectDocChat: (
    markdownLayerId: string,
    chatId: string,
    options?: { expandPanel?: boolean }
  ) => void
  /** Move selection to a chat id without re-resolving its target. */
  selectChatId: (chatId: string | null) => void
  /** Clear selection + collapse the panel when the given agent was selected. */
  clearIfSelected: (agentId: string) => void
  /** Remember a doc's last chat without changing the current selection. */
  rememberDocChat: (markdownLayerId: string, chatId: string) => void
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
  const { agents, chatSessions, markdownLayers, localTerminals, chatPanelRef } =
    deps

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  /**
   * When a chat tab targets a document layer instead of an agent's branch the
   * panel pivots into "doc mode". Mutually exclusive with `selectedAgentId` from
   * the panel's POV.
   */
  const [selectedDocumentChatTargetId, setSelectedDocumentChatTargetId] =
    useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  // Agents created this session whose sandbox isn't streaming logs yet. A
  // LogProbe is rendered for each (see `pendingProbes`); on ready we flip
  // selection and drop the id.
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([])

  // Per-repo / per-agent / per-document memory so switching back restores the
  // prior selection.
  const selectedAgentByRepoRef = useRef<Record<string, string>>({})
  const selectedChatByAgentRef = useRef<Record<string, string>>({})
  const selectedChatByDocumentRef = useRef<Record<string, string>>({})

  const expandPanel = useCallback(() => {
    const panel = chatPanelRef.current
    if (panel?.isCollapsed()) {
      panel.expand()
      const { inPixels } = panel.getSize()
      if (inPixels < 480) panel.resize(480)
    }
  }, [chatPanelRef])

  const selectAgent = useCallback(
    (
      agentId: string | null,
      options?: { expandPanel?: boolean; clearDocument?: boolean }
    ) => {
      if (!agentId) return

      // Save the outgoing agent's chat selection.
      if (selectedAgentId && selectedChatId) {
        selectedChatByAgentRef.current[selectedAgentId] = selectedChatId
      }

      // Remember this agent as its repo's last-selected.
      const agent = agents.find((a) => a.id === agentId)
      if (agent) selectedAgentByRepoRef.current[agent.repoId] = agentId

      if (options?.clearDocument) setSelectedDocumentChatTargetId(null)
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

  const selectDocument = useCallback((markdownLayerId: string) => {
    setSelectedAgentId(null)
    setSelectedDocumentChatTargetId(markdownLayerId)
    const lastChat = selectedChatByDocumentRef.current[markdownLayerId]
    setSelectedChatId(lastChat ?? null)
  }, [])

  const selectChat = useCallback(
    (chatId: string | null) => {
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
        if (chat.markdownLayerId) {
          setSelectedDocumentChatTargetId(chat.markdownLayerId)
          selectedChatByDocumentRef.current[chat.markdownLayerId] = chatId
        }
      }
    },
    [chatSessions, localTerminals]
  )

  const selectAgentChat = useCallback(
    (
      branchId: string,
      chatId: string,
      options?: {
        expandPanel?: boolean
        clearDocument?: boolean
        remember?: boolean
      }
    ) => {
      setSelectedAgentId(branchId)
      if (options?.clearDocument) setSelectedDocumentChatTargetId(null)
      setSelectedChatId(chatId)
      if (options?.remember) selectedChatByAgentRef.current[branchId] = chatId
      if (options?.expandPanel) expandPanel()
    },
    [expandPanel]
  )

  const selectDocChat = useCallback(
    (
      markdownLayerId: string,
      chatId: string,
      options?: { expandPanel?: boolean }
    ) => {
      setSelectedAgentId(null)
      setSelectedDocumentChatTargetId(markdownLayerId)
      setSelectedChatId(chatId)
      selectedChatByDocumentRef.current[markdownLayerId] = chatId
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

  const rememberDocChat = useCallback(
    (markdownLayerId: string, chatId: string) => {
      selectedChatByDocumentRef.current[markdownLayerId] = chatId
    },
    []
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

  // Auto-select the first running agent when none is selected. Booting agents
  // aren't picked here — a LogProbe promotes them once their sandbox streams
  // logs, which avoids the "switch to empty panel then hang on 'Connecting…'"
  // flicker. Skipped when the user has explicitly pointed the panel at a
  // document — otherwise picking a doc (which sets `selectedAgentId` to null)
  // would immediately snap selection back to a running agent.
  useEffect(() => {
    if (selectedDocumentChatTargetId) return
    if (selectedAgentId && agents.some((a) => a.id === selectedAgentId)) return
    const firstRunning = agents.find(
      (a) => a.status === "running" && a.sandboxName
    )
    // Picking a default once async-loaded agent data arrives is a legitimate
    // effect sync, not an avoidable render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (firstRunning) setSelectedAgentId(firstRunning.id)
  }, [selectedAgentId, agents, selectedDocumentChatTargetId])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const selectedDocLayer = selectedDocumentChatTargetId
    ? (markdownLayers.find((d) => d.id === selectedDocumentChatTargetId) ?? null)
    : null
  const target = resolveChatPanelTarget(selectedAgent, selectedDocLayer)

  return {
    target,
    selectedAgent,
    selectedAgentId,
    selectedDocumentChatTargetId,
    selectedChatId,
    pendingProbes: pendingProbes(pendingAgentIds, agents),
    selectAgent,
    selectDocument,
    selectChat,
    selectAgentChat,
    selectDocChat,
    selectChatId,
    clearIfSelected,
    rememberDocChat,
    rememberedAgentChatId,
    addPending,
    handlePendingReady,
    expandPanel,
  }
}
