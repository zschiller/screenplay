"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  Plus,
  X,
  PanelRightClose,
  ChevronsUpDown,
  Check,
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  ArrowUpRight,
  Logs,
} from "lucide-react"
import { AnimatePresence, motion, Reorder } from "motion/react"
import { toast } from "sonner"
import { createPullRequestAction } from "@/lib/create-pr-action"
import { openExternal } from "@/lib/open-external"
import { Spinner } from "@workspace/ui/components/spinner"
import { EditableText } from "@workspace/ui/components/editable-text"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { AgentChat } from "./agent-chat"
import { LogsPanel } from "./logs-panel"
import { ChatHistoryMenu, ChatRunIndicator } from "./chat-history-menu"
import { TAB_LABEL_CLASS, TAB_LABEL_EDIT_CLASS } from "./tab-label"
import { TerminalDrawer } from "./terminal-drawer"
import { useOverflowingTabs } from "./use-overflowing-tabs"
import { BranchBadge } from "@/components/branch-badge"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
  TerminalTabData,
} from "@/lib/types"
import { CHAT_TARGETABLE_LAYER_KINDS, getLayerKind } from "@/lib/layer-kinds"
import {
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readTabOrder,
  writeLastHarnessKey,
  writeLastTabKind,
  writeTabOrder,
} from "@/lib/canvas/tab-kind"
import { useAppSession } from "@/lib/auth-client"
import { useInstalledHarnesses } from "@/hooks/use-installed-harnesses"
import type { AgentMessage } from "@/lib/agent/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo, BranchPrState } from "@/lib/github-actions"
import { chatStore } from "@/lib/chat-store"

const LOGS_TAB_VALUE = "__sandbox_logs__"

// Scan a chat's messages newest-first for the most recent completed
// `create_pr` tool call and pull the PR url/number out of its output. Pure over
// `messages` so the `useMemo` below is a single reactive call the compiler can
// preserve.
function findLatestPr(
  messages: AgentMessage[]
): { url: string; number: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m.role === "tool_call" &&
      m.title === "create_pr" &&
      m.status === "completed"
    ) {
      const output = m.content
        .map((b) =>
          b.type === "content" && b.content.type === "text"
            ? b.content.text
            : ""
        )
        .join("\n")
      const url = output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
      const num = output.match(/#(\d+)/)?.[1]
      if (url && num) return { url, number: num }
    }
  }
  return null
}

function useLatestPr(chatId: string): { url: string; number: string } | null {
  const messages = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).messages,
    () => []
  )
  return useMemo(() => findLatestPr(messages), [messages])
}

function useAnyChatStreaming(chatIds: string[]): boolean {
  const key = chatIds.join(",")
  const subscribe = useCallback(
    (cb: () => void) => {
      const unsubs = chatIds.map((id) => chatStore.subscribe(id, cb))
      return () => unsubs.forEach((u) => u())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  const getSnapshot = useCallback(
    () => chatIds.some((id) => chatStore.getSnapshot(id).isStreaming),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function ChatTabLabel({
  chat,
  onRename,
}: {
  chat: ChatSessionData
  onRename: (label: string) => void
}) {
  return (
    <span className="flex items-center gap-1.5">
      <ChatRunIndicator chatId={chat.id} />
      <EditableText
        as="span"
        value={chat.label}
        onCommit={onRename}
        placeholder="Untitled"
        className={TAB_LABEL_CLASS}
        viewClassName="truncate"
        editClassName={TAB_LABEL_EDIT_CLASS}
      />
    </span>
  )
}

/**
 * The chat panel can target one of two top-level kinds:
 *  - an *agent* (sandbox-backed flow): file editing, git, PR creation, logs.
 *  - a *layer* of any kind whose `LayerKindDescriptor.canBeChatTarget` is
 *    true (currently just markdownLayers). The `layerKind` discriminator
 *    determines which descriptor's icon/label drives the chrome and which
 *    server-side toolset runs.
 *
 * New layer kinds become valid chat targets by setting
 * `canBeChatTarget: true` on their descriptor and registering a server-side
 * `chat-target-kinds` entry — no changes here needed.
 */
export type ChatPanelTarget =
  | { kind: "agent"; agent: BranchData }
  | {
      kind: "layer"
      layerKind: string
      layer: { id: string } & Record<string, unknown>
    }

interface ChatPanelProps {
  target: ChatPanelTarget
  agents: BranchData[]
  markdownLayers: MarkdownLayerData[]
  onSelectAgent: (id: string) => void
  /** Generalised "pick a layer-kind target" callback — receives the kind
   *  ("markdown-layer", future kinds, …) and the layer id. */
  onSelectLayer: (layerKind: string, layerId: string) => void
  chatSessions: ChatSessionData[]
  /** This client's local terminal tabs for the current target. Held in their
   *  own collection (never `chatSessions`), so a terminal can't enter the
   *  conversation model. Empty/absent for non-agent (layer) targets. */
  terminalTabs?: TerminalTabData[]
  selectedChatId: string | null
  roomId: string
  onSelectChat: (chatId: string | null) => void
  onCreateChat: () => void
  /** Open a new terminal tab against the current agent's sandbox, launching the
   *  given harness (by `Harness.key`). Absent for non-agent (layer) targets,
   *  which have no sandbox to attach a terminal to. */
  onCreateTerminal?: (harnessKey: string) => void
  onRenameChat: (chatId: string, label: string) => void
  onRemoveChat: (chatId: string) => void
  /** Close a tab. `nextSelectedId` is the visual neighbour to fall back to when
   *  the closed tab was selected — the tab after it in the displayed order, or
   *  the one before it when closing the last tab. Undefined when no other tab
   *  survives (the parent then recreates a default tab). */
  onCloseChat: (chatId: string, nextSelectedId?: string) => void
  onReopenChat: (chatId: string) => void
  onBranchRename: (branch: string) => void
  onPlanModeChange: (chatId: string, planMode: boolean) => void
  onModelChange: (chatId: string, model: string) => void
  diffStats?: DiffStats
  /**
   * GitHub-polled PR state for this agent's branch. Used as a fallback when
   * the current chat's history doesn't contain a `create_pr` tool result —
   * e.g. PR was opened from a different chat tab, the gh CLI, or GitHub
   * directly. Without this the "Create PR" button can show even when a PR
   * is already open.
   */
  branchPr?: BranchPrInfo | null
  /**
   * Records a freshly-created PR into the shared source of truth so the sidebar
   * icon and branch menu update the instant this panel's "Create PR" button
   * succeeds, rather than on the next 60s poll.
   */
  onPrCreated?: (branchId: string, pr: BranchPrInfo) => void
  onCollapse?: () => void
  onLogsReady?: () => void
  disableBranchPicker?: boolean
}

export function ChatPanel({
  target,
  agents,
  markdownLayers,
  onSelectAgent,
  onSelectLayer,
  chatSessions,
  terminalTabs,
  selectedChatId,
  roomId,
  onSelectChat,
  onCreateChat,
  onCreateTerminal,
  onRenameChat,
  onRemoveChat,
  onCloseChat,
  onReopenChat,
  onBranchRename,
  onPlanModeChange,
  onModelChange,
  diffStats,
  branchPr,
  onPrCreated,
  onCollapse,
  onLogsReady,
  disableBranchPicker,
}: ChatPanelProps) {
  const isAgentTarget = target.kind === "agent"
  const agent = target.kind === "agent" ? target.agent : null
  // Layer-kind targets (currently just markdownLayers) are routed through the
  // shared `LayerKindDescriptor` registry; the chrome (target pill,
  // picker entry) reads icon/label from there so future kinds light up
  // without changes to this file.
  const layerTarget = target.kind === "layer" ? target : null

  // The tab strip holds only the durable chats, createdAt-ordered. Terminals
  // are ephemeral shells, not conversations, so they live in their own drawer
  // under the composer (`TerminalDrawer`) with their own tabs.
  const openTabs = useMemo(
    () =>
      chatSessions
        .filter((c) => !c.closedAt)
        .sort((a, b) => a.createdAt - b.createdAt),
    [chatSessions]
  )
  const terminals = useMemo(
    () => [...(terminalTabs ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [terminalTabs]
  )

  const closedChats = useMemo(
    () =>
      [...chatSessions]
        .filter((c) => c.closedAt)
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [chatSessions]
  )

  // Auto-select the first open chat (or, with none, the first terminal) if
  // nothing is selected.
  useEffect(() => {
    if (selectedChatId) return
    const first = openTabs[0]?.id ?? terminals[0]?.id
    if (first) onSelectChat(first)
  }, [selectedChatId, openTabs, terminals, onSelectChat])

  // The panel's selection is one id shared by chats and terminals (the Tab
  // Pool selects a new terminal the same way it selects a new chat). A chat id
  // picks the strip's tab; a terminal id opens the drawer on that terminal and
  // leaves the strip on the last chat shown. Tracked with the previous-value
  // pattern so a selection change is handled once, during render.
  const selectedTerminal = terminals.find((t) => t.id === selectedChatId)
  const selectionKey = selectedTerminal
    ? `terminal:${selectedTerminal.id}`
    : (selectedChatId ?? "")
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey)
  const [drawerOpen, setDrawerOpen] = useState(!!selectedTerminal)
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    selectedTerminal?.id ?? null
  )
  const [lastChatId, setLastChatId] = useState<string | null>(
    selectedTerminal ? null : selectedChatId
  )
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey)
    if (selectedTerminal) {
      setActiveTerminalId(selectedTerminal.id)
      setDrawerOpen(true)
    } else if (selectedChatId) {
      setLastChatId(selectedChatId)
    }
  }
  const activeTab =
    (lastChatId && openTabs.some((c) => c.id === lastChatId)
      ? lastChatId
      : openTabs[0]?.id) ?? ""
  const shownTerminalId =
    activeTerminalId && terminals.some((t) => t.id === activeTerminalId)
      ? activeTerminalId
      : (terminals[0]?.id ?? null)
  const chatHistoryPr = useLatestPr(activeTab)
  const displayPr: {
    url: string
    number: string
    state?: BranchPrState
  } | null =
    chatHistoryPr ??
    (branchPr
      ? {
          url: branchPr.url,
          number: String(branchPr.number),
          state: branchPr.state,
        }
      : null)
  // The PR button's icon and color mirror the sidebar branch icon so the two
  // stay legible together: open = green, merged = purple, closed = red.
  const prState = displayPr?.state
  const PrStateIcon =
    prState === "merged"
      ? GitMerge
      : prState === "closed"
        ? GitPullRequestClosed
        : GitPullRequest
  const prStateColor =
    prState === "merged"
      ? "text-purple-600 dark:text-purple-400"
      : prState === "closed"
        ? "text-red-600 dark:text-red-400"
        : "text-green-700 dark:text-green-300"
  const isAgentBusy = agent
    ? agent.status === "creating" || agent.status === "starting"
    : false
  const allChatIds = useMemo(
    () => chatSessions.map((c) => c.id),
    [chatSessions]
  )
  const anyChatStreaming = useAnyChatStreaming(allChatIds)
  const [showLogs, setShowLogs] = useState(false)
  const [creatingPr, setCreatingPr] = useState(false)
  const tabsValue = showLogs ? LOGS_TAB_VALUE : activeTab

  // The harnesses installed in this deployment's sandboxes — the menu the caret
  // draws (#290). Only fetched when terminals are creatable here (agent target).
  const { data: session } = useAppSession()
  const userId = session?.user.id
  const installedHarnesses = useInstalledHarnesses(!!onCreateTerminal)

  // The harness the drawer's "+" launches: the operator's last pick if it's
  // still installed, else the first installed harness, else the catalog default
  // (list not loaded yet / none installed). Read per-User from localStorage
  // during render — a hint only, never authoritative (a tab's harness lives on
  // its `terminal_tab.harnessKey` row), so a stale value can't change an
  // existing tab.
  const storedHarnessKey = userId ? readLastHarnessKey(userId) : null
  const defaultHarnessKey =
    storedHarnessKey &&
    installedHarnesses.some((h) => h.key === storedHarnessKey)
      ? storedHarnessKey
      : (installedHarnesses[0]?.key ?? DEFAULT_HARNESS_KEY)

  // The last-used kind is still recorded: it's the per-user pref a fresh
  // Workspace seeds its first tab from.
  const createChatTab = useCallback(() => {
    writeLastTabKind("chat")
    onCreateChat()
  }, [onCreateChat])

  // Launch a terminal with `harnessKey` and remember it, so the drawer's "+"
  // repeats *this* harness (keyed per User, it survives reload). The Tab Pool
  // selects the new terminal, which opens the drawer on it.
  const createTerminalTab = useCallback(
    (harnessKey: string) => {
      writeLastTabKind("terminal")
      if (userId) writeLastHarnessKey(userId, harnessKey)
      onCreateTerminal?.(harnessKey)
    },
    [onCreateTerminal, userId]
  )

  // Opening an empty drawer starts a terminal rather than showing nothing.
  const toggleDrawer = useCallback(() => {
    if (!drawerOpen && terminals.length === 0) {
      createTerminalTab(defaultHarnessKey)
      return
    }
    setDrawerOpen((o) => !o)
  }, [drawerOpen, terminals.length, createTerminalTab, defaultHarnessKey])

  // ⌃` toggles the drawer, from anywhere — a focused terminal included, which
  // is why it listens in the capture phase.
  useEffect(() => {
    if (!onCreateTerminal) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || !e.ctrlKey) return
      if (e.metaKey || e.altKey || e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      toggleDrawer()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [onCreateTerminal, toggleDrawer])

  // Close a terminal from the drawer. The drawer moves to its neighbour, and
  // the panel's selection (if it was on this terminal) goes back to the chat.
  const closeTerminal = useCallback(
    (id: string) => {
      const idx = terminals.findIndex((t) => t.id === id)
      const neighbour = (terminals[idx + 1] ?? terminals[idx - 1])?.id
      if (id === shownTerminalId) setActiveTerminalId(neighbour ?? null)
      if (!neighbour) setDrawerOpen(false)
      onCloseChat(id, activeTab || neighbour)
    },
    [terminals, shownTerminalId, onCloseChat, activeTab]
  )

  // Reset the logs-visible flag whenever the chat target changes so a
  // freshly-selected target (whose LogsPanel is still fetching, if any)
  // doesn't inherit the previous target's "logs tab open" state. Done during
  // render via the previous-value pattern rather than in an effect, which
  // would cascade an extra render after the target switch.
  const targetKey = agent?.id ?? layerTarget?.layer.id ?? ""
  const [lastTargetKey, setLastTargetKey] = useState(targetKey)
  // Operator's drag-chosen tab order for this target (ids), seeded from
  // localStorage. Reconciled with the live tab set in `orderedTabs` below.
  const [tabOrder, setTabOrder] = useState<string[]>(() =>
    readTabOrder(targetKey)
  )
  // Tabs whose enter animation has finished (or that were already present when
  // this target's strip mounted). motion's Reorder REMOUNTS the dragged tab on
  // each swap; for a freshly-created tab that remount replays its width/opacity
  // enter for one frame — a visible flash/flicker, worst when moving rightward.
  // motion suppresses that replay for tabs present at an AnimatePresence's first
  // render, which is why older tabs reorder cleanly. So once a new tab finishes
  // entering we bump `reRegisterKey` to remount the AnimatePresence (still
  // `initial={false}`), re-registering every current tab — the new one included
  // — as "initial-present". From then on it reorders as cleanly as an older tab.
  const [enteredIds, setEnteredIds] = useState<Set<string>>(
    () => new Set(openTabs.map((t) => t.id))
  )
  const [reRegisterKey, setReRegisterKey] = useState(0)
  // A remount mid-drag would drop the gesture, so if a tab settles while the
  // operator is dragging, defer the re-register until the pointer is released.
  const draggingRef = useRef(false)
  const pendingReRegisterRef = useRef(false)
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey)
    setShowLogs(false)
    // Switching targets swaps in that target's own saved arrangement.
    setTabOrder(readTabOrder(targetKey))
    // The targetKey-keyed Reorder.Group remounts on switch, so this target's
    // tabs are already initial-present — seed them so they don't re-register.
    setEnteredIds(new Set(openTabs.map((t) => t.id)))
  }

  // The displayed tab order: stored ids first (in saved order, skipping any
  // that have since closed), then any tabs not yet in the saved order appended
  // in their createdAt order. So a brand-new tab always lands at the end and a
  // never-reordered target falls back to pure createdAt order.
  const orderedTabs = useMemo<ChatSessionData[]>(() => {
    if (tabOrder.length === 0) return openTabs
    const byId = new Map(openTabs.map((t) => [t.id, t] as const))
    const result: ChatSessionData[] = []
    for (const id of tabOrder) {
      const tab = byId.get(id)
      if (tab) {
        result.push(tab)
        byId.delete(id)
      }
    }
    for (const tab of openTabs) if (byId.has(tab.id)) result.push(tab)
    return result
  }, [openTabs, tabOrder])

  const handleReorder = useCallback(
    (nextIds: string[]) => {
      setTabOrder(nextIds)
      writeTabOrder(targetKey, nextIds)
    },
    [targetKey]
  )

  // Called when a tab's enter animation completes. The first time we see a tab
  // that wasn't already registered, remount the AnimatePresence so motion treats
  // it as initial-present (see `enteredIds` above) — deferred if a drag is in
  // flight so the remount can't interrupt the gesture.
  const markTabEntered = useCallback(
    (id: string) => {
      if (enteredIds.has(id)) return
      setEnteredIds((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
      if (draggingRef.current) {
        pendingReRegisterRef.current = true
        return
      }
      setReRegisterKey((k) => k + 1)
    },
    [enteredIds]
  )

  // Clear the drag flag (and flush any deferred re-register) on pointer release —
  // pointerup can land outside the strip after a drag, so listen on the window.
  useEffect(() => {
    const onPointerUp = () => {
      draggingRef.current = false
      if (pendingReRegisterRef.current) {
        pendingReRegisterRef.current = false
        setReRegisterKey((k) => k + 1)
      }
    }
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerUp)
    return () => {
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
    }
  }, [])

  // The tab to select when `closingId` is closed: its neighbour in the *displayed*
  // order — the next tab, or the previous one when closing the last tab. Undefined
  // when it's the only tab. The parent prefers this over its own createdAt-ordered
  // fallback so closing a tab lands on the visually adjacent one, not the oldest.
  const neighbourTabId = useCallback(
    (closingId: string) => {
      const idx = orderedTabs.findIndex((t) => t.id === closingId)
      if (idx === -1) return undefined
      return (orderedTabs[idx + 1] ?? orderedTabs[idx - 1])?.id
    },
    [orderedTabs]
  )

  // The strip clips rather than scrolls: a tab that doesn't fully fit is
  // hidden (never shown half-cut) and reachable from the "All chats" menu.
  const tabBarRef = useRef<HTMLDivElement>(null)
  const orderedIds = useMemo(() => orderedTabs.map((t) => t.id), [orderedTabs])
  const overflowingIds = useOverflowingTabs(
    tabBarRef,
    orderedIds,
    reRegisterKey
  )

  // Keep the active chat on screen: if it's one of the hidden tabs (picked
  // from the menu, or just created at the end of a full strip), move it into
  // the last visible slot. Done during render, like the target switch above;
  // once moved it sits at or before the last visible slot, so this runs once
  // per measurement. If it's still too wide the next measurement moves it one
  // slot further left, so it settles. The move isn't saved as the operator's
  // order — only a drag is.
  if (activeTab && overflowingIds.has(activeTab)) {
    const from = orderedIds.indexOf(activeTab)
    let to = -1
    orderedIds.forEach((id, i) => {
      if (!overflowingIds.has(id)) to = i
    })
    if (to >= 0 && to < from) {
      const next = orderedIds.filter((id) => id !== activeTab)
      next.splice(to, 0, activeTab)
      setTabOrder(next)
    }
  }

  // Fired by LogsPanel the first time it successfully connects to the stream.
  // We only auto-open logs at this point (not on agent.status === "starting")
  // so the panel doesn't flash before there's anything to show.
  const handleLogsConnected = useCallback(() => {
    if (agent && (agent.status === "creating" || agent.status === "starting")) {
      setShowLogs(true)
      onLogsReady?.()
    }
  }, [agent, onLogsReady])

  // Once setup finishes (status flips from creating/starting → running), switch
  // back from the auto-opened logs tab to the chat tab. Only relevant for
  // agent targets — doc targets have no setup phase.
  const prevStatusRef = useRef(agent?.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    if (
      agent &&
      (prev === "creating" || prev === "starting") &&
      agent.status === "running"
    ) {
      setShowLogs(false)
    }
    prevStatusRef.current = agent?.status
  }, [agent])

  // Calls the direct PR-creation server action (#355) — same path as the Branch
  // menu's "Create pull request" item, no model turn. The created PR (or a
  // redacted error) surfaces in a toast.
  const handleCreatePr = async () => {
    if (!agent?.sandboxName || creatingPr) return
    setCreatingPr(true)
    try {
      const result = await createPullRequestAction(roomId, agent.sandboxName)
      if (result.success) {
        const { url, number } = result.value
        onPrCreated?.(agent.id, { number, url, state: "open" })
        toast.success("Pull request created", {
          description: `#${number}`,
          action: {
            label: "View on GitHub",
            onClick: () => openExternal(url),
          },
        })
      } else {
        toast.error("Couldn't create pull request", {
          description: result.error,
        })
      }
    } finally {
      setCreatingPr(false)
    }
  }

  const handleTabChange = (value: string) => {
    if (value === LOGS_TAB_VALUE) {
      setShowLogs(true)
    } else {
      setShowLogs(false)
      onSelectChat(value)
    }
  }

  return (
    <Tabs
      value={tabsValue}
      onValueChange={handleTabChange}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-12 items-center bg-background px-3">
        {onCollapse && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="mr-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                  onClick={onCollapse}
                >
                  <PanelRightClose />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Collapse chat <Kbd>⌘I</Kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {disableBranchPicker ? (
          <TargetPill target={target} />
        ) : (
          <TargetPicker
            agents={agents}
            markdownLayers={markdownLayers}
            target={target}
            onSelectAgent={onSelectAgent}
            onSelectLayer={onSelectLayer}
          />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Diff stats and the PR button are agent-only — there's no
              git/branch concept for a doc target. */}
          {isAgentTarget &&
            diffStats &&
            (diffStats.additions > 0 || diffStats.deletions > 0) && (
              <span className="flex items-center gap-1 font-mono text-[10px]">
                <span className="text-green-700 dark:text-green-300">
                  +{diffStats.additions}
                </span>
                <span className="text-red-700 dark:text-red-300">
                  -{diffStats.deletions}
                </span>
              </span>
            )}
          {isAgentTarget &&
            (displayPr ? (
              <Button size="xs" variant="outline" asChild>
                <a
                  href={displayPr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("group", prStateColor)}
                >
                  <PrStateIcon />#{displayPr.number}
                  <ArrowUpRight className="opacity-60 group-hover:opacity-100" />
                </a>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={handleCreatePr}
                disabled={
                  !agent?.sandboxName ||
                  isAgentBusy ||
                  anyChatStreaming ||
                  creatingPr
                }
                title={
                  isAgentBusy
                    ? "Sandbox still starting…"
                    : anyChatStreaming
                      ? "Agent is working in this workspace…"
                      : undefined
                }
              >
                <GitPullRequest />
                Create PR
              </Button>
            ))}
        </div>
      </div>
      <div className="flex h-9 items-stretch border-b border-border bg-background pr-1.5">
        <div ref={tabBarRef} className="flex min-w-0 flex-1 overflow-hidden">
          <TabsList variant="line" className="h-full! gap-3 px-2 py-0">
            {isAgentTarget && (
              <TabsTrigger
                value={LOGS_TAB_VALUE}
                className="h-full! shrink-0 px-1 after:bottom-0!"
                aria-label="Sandbox logs"
                title="Sandbox logs"
              >
                <Logs className="size-3.5" />
              </TabsTrigger>
            )}
            {/* Drag-reorderable chat tabs. The logs trigger stays fixed
                (outside the group); only these tabs reorder.
                `values`/`onReorder` are controlled by `tabOrder`. */}
            <Reorder.Group
              // Keyed by the target so switching branches/layers REMOUNTS the
              // whole group instead of diffing this target's tab ids against the
              // previous one's. Without it, every tab from the old target exits
              // and every tab from the new one enters on each switch — the tabs
              // animate/jitter. A fresh mount (with AnimatePresence
              // `initial={false}`) paints the new target's tabs with no anim.
              key={targetKey}
              as="div"
              axis="x"
              values={orderedTabs.map((t) => t.id)}
              onReorder={handleReorder}
              // Mark a drag (or click) as in-flight so a tab settling mid-gesture
              // defers its AnimatePresence re-register until pointer release.
              onPointerDownCapture={() => {
                draggingRef.current = true
              }}
              className="flex h-full items-stretch gap-1 overflow-visible"
            >
              {/* `key={reRegisterKey}` remounts this AnimatePresence whenever a
                  newly-created tab finishes entering, re-registering all tabs as
                  initial-present so motion stops replaying the new tab's enter on
                  its reorder-remounts (the rightward-drag flash). */}
              <AnimatePresence key={reRegisterKey} initial={false}>
                {orderedTabs.map((tab) => (
                  <Reorder.Item
                    key={tab.id}
                    value={tab.id}
                    as="div"
                    // Animate only position, not size, during a reorder. The
                    // enter/exit on the inner wrapper drives `width` (0↔auto);
                    // a full `layout` animation here would also project the
                    // size change and fight that width tween, jittering the
                    // tab. `layout="position"` reorders by sliding neighbours
                    // aside while leaving width to the wrapper alone.
                    layout="position"
                    data-tab-id={tab.id}
                    // A tab that doesn't fully fit is hidden, not cut off; the
                    // "All chats" menu lists it.
                    aria-hidden={overflowingIds.has(tab.id) || undefined}
                    className={cn(
                      "flex shrink-0 items-stretch",
                      overflowingIds.has(tab.id) && "invisible"
                    )}
                  >
                    {/* Enter/exit lives on this inner wrapper, NOT the
                        Reorder.Item: the item runs a layout animation while
                        dragging (that's how neighbours slide aside), and driving
                        `width` on the same element fights that projection and
                        jitters. Here the wrapper collapses its width 0↔auto while
                        the trigger keeps its min-width, so the tab clips instead
                        of truncating its label. `overflow-x-clip` (not
                        `overflow-x-hidden`, which would force overflow-y to auto)
                        keeps the active underline — an ::after at bottom-[-5px] —
                        visible. `initial={false}` on AnimatePresence skips this on
                        first paint, so only tabs added/removed after mount
                        animate. */}
                    <motion.div
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      onAnimationComplete={() => markTabEntered(tab.id)}
                      className="flex items-stretch overflow-x-clip bg-background"
                    >
                      <TabsTrigger
                        value={tab.id}
                        className="group/tab relative h-full! min-w-[72px] cursor-grab px-2 text-[13px] after:bottom-0! active:cursor-grabbing"
                      >
                        <ChatTabLabel
                          chat={tab}
                          onRename={(label) => onRenameChat(tab.id, label)}
                        />
                        <div className="absolute top-0 right-0 bottom-0 flex items-center bg-[var(--background)] pr-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100">
                          <div className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)]" />
                          <span
                            role="button"
                            tabIndex={0}
                            title="Close"
                            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            // The X lives inside a Radix TabsTrigger, which selects
                            // the tab on pointer/mouse-down and on focus. Stop those
                            // from reaching the trigger and preventDefault so the X
                            // never takes focus (whose focusin would bubble up and
                            // auto-activate the tab) — otherwise closing an
                            // unselected tab selects it first.
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onCloseChat(tab.id, neighbourTabId(tab.id))
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                e.stopPropagation()
                                onCloseChat(tab.id, neighbourTabId(tab.id))
                              }
                            }}
                          >
                            <X className="size-3" />
                          </span>
                        </div>
                      </TabsTrigger>
                    </motion.div>
                  </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </TabsList>
        </div>
        {/* Pinned outside the clipping strip, so however many tabs are open,
            "+" and the menu stay on screen. */}
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={createChatTab}
            disabled={isAgentBusy}
            aria-label="New chat"
            title={isAgentBusy ? "Sandbox still starting…" : "New chat"}
          >
            <Plus className="size-3" />
          </Button>
          <ChatHistoryMenu
            openChats={orderedTabs}
            overflowingIds={overflowingIds}
            activeChatId={showLogs ? "" : activeTab}
            closedChats={closedChats}
            onSelect={handleTabChange}
            onReopen={onReopenChat}
            onDelete={onRemoveChat}
          />
        </div>
      </div>

      {agent && (
        <TabsContent
          value={LOGS_TAB_VALUE}
          className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          forceMount
        >
          <LogsPanel
            sandboxName={agent.sandboxName}
            onConnected={handleLogsConnected}
          />
        </TabsContent>
      )}

      {openTabs.length === 0 && !showLogs && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="text-sm text-muted-foreground">No open chats</p>
          <Button
            size="sm"
            variant="outline"
            onClick={createChatTab}
            disabled={isAgentBusy}
          >
            <Plus />
            New chat
          </Button>
        </div>
      )}

      {openTabs.map((chat) => {
        // First chat for this target — drives auto branch/chat naming on the
        // agent flow; for doc chats it's just used to skip naming logic.
        const isFirst = !chatSessions.some(
          (c) =>
            c.id !== chat.id &&
            ((chat.branchId && c.branchId === chat.branchId) ||
              (chat.markdownLayerId &&
                c.markdownLayerId === chat.markdownLayerId))
        )
        return (
          <TabsContent
            key={chat.id}
            value={chat.id}
            className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            forceMount
          >
            <AgentChat
              chatId={chat.id}
              roomId={roomId}
              sandboxId={agent?.id}
              sandboxName={agent?.sandboxName}
              sandboxStatus={agent?.status}
              branch={agent?.ref}
              markdownLayerId={
                layerTarget?.layerKind === "markdown-layer"
                  ? layerTarget.layer.id
                  : undefined
              }
              isFirstChat={isFirst}
              autoNamedBranch={agent?.autoNamedBranch}
              planMode={chat.planMode}
              onPlanModeChange={(pm) => onPlanModeChange(chat.id, pm)}
              model={chat.model}
              onModelChange={(m) => onModelChange(chat.id, m)}
              onBranchRename={onBranchRename}
              onChatRename={(label) => onRenameChat(chat.id, label)}
              isActive={!showLogs && chat.id === activeTab}
            />
          </TabsContent>
        )
      })}

      {/* Terminals only exist against an agent's sandbox. */}
      {onCreateTerminal && (
        <TerminalDrawer
          terminals={terminals}
          open={drawerOpen}
          onToggle={toggleDrawer}
          activeId={shownTerminalId}
          onActiveChange={setActiveTerminalId}
          onClose={closeTerminal}
          onRename={onRenameChat}
          onCreate={createTerminalTab}
          harnesses={installedHarnesses}
          defaultHarnessKey={defaultHarnessKey}
          disabled={isAgentBusy}
          roomId={roomId}
          sandboxName={agent?.sandboxName}
          sandboxStatus={agent?.status}
        />
      )}
    </Tabs>
  )
}

/**
 * Renders the picker pill for the panel's current target. The agent
 * branch flavour stays a branch badge (its chrome is unique); every layer
 * kind renders generically through its `LayerKindDescriptor` (icon +
 * label), so adding a new chat-targetable kind doesn't touch this file.
 */
function TargetPill({ target }: { target: ChatPanelTarget }) {
  if (target.kind === "agent") {
    return (
      <BranchBadge
        branch={target.agent.ref}
        colorKey={target.agent.id}
        colorIndex={target.agent.colorIndex}
        className="px-1.5 py-0 text-[11px]"
      />
    )
  }
  const descriptor = getLayerKind(target.layerKind)
  if (!descriptor) return null
  const label = descriptor.getLabel(target.layer as never)
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="max-w-[14rem] truncate">{label}</span>
    </span>
  )
}

/**
 * Unified picker for the chat panel's target. Lists every available agent
 * branch *and* every chat-targetable layer kind. Sections are driven by
 * `CHAT_TARGETABLE_LAYER_KINDS` from the layer-kinds registry, so a new
 * layer kind that opts in via `canBeChatTarget: true` automatically gets
 * its own section here without any edits to this component.
 */
function TargetPicker({
  agents,
  markdownLayers,
  target,
  onSelectAgent,
  onSelectLayer,
}: {
  agents: BranchData[]
  /** All chat-targetable layers, keyed by kind. The picker renders one
   *  CommandGroup per kind in registry order. */
  markdownLayers: MarkdownLayerData[]
  target: ChatPanelTarget
  onSelectAgent: (id: string) => void
  onSelectLayer: (layerKind: string, layerId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pickableAgents = agents.filter(
    (a) => a.ref && a.status !== "error" && a.status !== "stopped"
  )

  // Keyed by `descriptor.kind` so the picker loop below can look up each
  // chat-targetable kind without a per-kind branch.
  const layersByKind: Record<
    string,
    Array<{ id: string } & Record<string, unknown>>
  > = {
    "markdown-layer": markdownLayers,
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-0.5">
          <TargetPill target={target} />
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="start">
        <Command>
          <CommandInput placeholder="Search workspaces and layers…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {pickableAgents.length > 0 && (
              <CommandGroup heading="Workspaces">
                {pickableAgents.map((a) => {
                  const isBusy =
                    a.status === "creating" || a.status === "starting"
                  const isCurrent =
                    target.kind === "agent" && a.id === target.agent.id
                  return (
                    <CommandItem
                      key={a.id}
                      value={`branch ${a.ref}`}
                      onSelect={() => {
                        onSelectAgent(a.id)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={`shrink-0 ${isCurrent ? "" : "opacity-0"}`}
                      />
                      <BranchBadge
                        branch={a.ref}
                        colorKey={a.id}
                        colorIndex={a.colorIndex}
                        className="px-1.5 py-0 text-[11px]"
                      />
                      {isBusy && <Spinner className="ml-auto size-3" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {CHAT_TARGETABLE_LAYER_KINDS.map((descriptor) => {
              const items = layersByKind[descriptor.kind] ?? []
              if (items.length === 0) return null
              return (
                <CommandGroup
                  key={descriptor.kind}
                  heading={descriptor.pluralLabel}
                >
                  {items.map((item) => {
                    const isCurrent =
                      target.kind === "layer" &&
                      target.layerKind === descriptor.kind &&
                      item.id === target.layer.id
                    const label = descriptor.getLabel(item as never)
                    return (
                      <CommandItem
                        key={item.id}
                        value={`${descriptor.kind} ${label}`}
                        onSelect={() => {
                          onSelectLayer(descriptor.kind, item.id)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={`shrink-0 ${isCurrent ? "" : "opacity-0"}`}
                        />
                        <span className="truncate">{label}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
