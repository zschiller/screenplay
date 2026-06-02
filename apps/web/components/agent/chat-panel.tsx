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
  Pencil,
  X,
  Archive,
  RotateCcw,
  PanelRightClose,
  ChevronsUpDown,
  ChevronDown,
  Check,
  GitPullRequest,
  ArrowUpRight,
  Logs,
  MessageCircle,
  SquareTerminal,
} from "lucide-react"
import { inputStore } from "@/lib/input-store"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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
import { TerminalTab } from "./terminal-tab"
import { BranchBadge } from "@/components/branch-badge"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
  TabKind,
  TerminalTabData,
} from "@/lib/types"
import { CHAT_TARGETABLE_LAYER_KINDS, getLayerKind } from "@/lib/layer-kinds"
import {
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readLastTabKind,
  writeLastHarnessKey,
  writeLastTabKind,
} from "@/lib/canvas/tab-kind"
import { useSession } from "@/lib/auth-client"
import { useInstalledHarnesses } from "@/hooks/use-installed-harnesses"
import type { AgentMessage } from "@/lib/agent/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"
import { chatStore } from "@/lib/chat-store"

const LOGS_TAB_VALUE = "__sandbox_logs__"

// Scan a chat's messages newest-first for the most recent `create_pr` tool
// result and pull the PR url/number out of its output. Pure over `messages`
// so the `useMemo` below is a single reactive call the compiler can preserve.
function findLatestPr(
  messages: AgentMessage[]
): { url: string; number: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "tool_result" && m.name === "create_pr") {
      const url = m.output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
      const num = m.output.match(/#(\d+)/)?.[1]
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

function useChatStatus(chatId: string) {
  const isStreaming = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).isStreaming,
    () => false
  )
  const hasUnread = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.hasUnread(chatId),
    () => false
  )
  return { isStreaming, hasUnread }
}

function ChatTabLabel({ chat }: { chat: ChatSessionData }) {
  const { isStreaming, hasUnread } = useChatStatus(chat.id)
  return (
    <span className="flex items-center gap-1.5">
      {isStreaming ? (
        <Spinner className="size-3 shrink-0 text-muted-foreground" />
      ) : hasUnread ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
      ) : null}
      <span className="max-w-[100px] truncate">{chat.label}</span>
    </span>
  )
}

/**
 * Tab label for a terminal tab. Visibly distinct from chat tabs — a terminal
 * glyph and a monospace label — so it's obvious which guarantees apply
 * (ephemeral + BYO harness, not durable + shared chat). Reads no chat-store
 * status: a terminal tab has no streaming/unread conversation state.
 */
function TerminalTabLabel({ terminal }: { terminal: TerminalTabData }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="max-w-[100px] truncate">{terminal.label}</span>
    </span>
  )
}

/**
 * One entry in the panel's tab strip. A tagged union over the two distinct tab
 * types so the strip can render both in a single createdAt-ordered row while
 * the underlying chat/terminal collections stay separate. `id`, `label`, and
 * `createdAt` are lifted out so ordering and the shared tab chrome (rename,
 * close) don't have to branch on `kind`.
 */
type OpenTab =
  | {
      kind: "chat"
      id: string
      label: string
      createdAt: number
      chat: ChatSessionData
    }
  | {
      kind: "terminal"
      id: string
      label: string
      createdAt: number
      terminal: TerminalTabData
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
  onCloseChat: (chatId: string) => void
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
  onCloseChat,
  onReopenChat,
  onBranchRename,
  onPlanModeChange,
  onModelChange,
  diffStats,
  branchPr,
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

  // The tab strip interleaves two distinct tab types — durable chats and
  // ephemeral terminals — in one createdAt-ordered row. We model each as a
  // tagged item rather than a shared base type so the conversation model can
  // never structurally hold a terminal.
  const openTabs = useMemo<OpenTab[]>(() => {
    const items: OpenTab[] = [
      ...chatSessions
        .filter((c) => !c.closedAt)
        .map((c) => ({
          kind: "chat" as const,
          id: c.id,
          label: c.label,
          createdAt: c.createdAt,
          chat: c,
        })),
      ...(terminalTabs ?? []).map((t) => ({
        kind: "terminal" as const,
        id: t.id,
        label: t.label,
        createdAt: t.createdAt,
        terminal: t,
      })),
    ]
    return items.sort((a, b) => a.createdAt - b.createdAt)
  }, [chatSessions, terminalTabs])

  const closedChats = useMemo(
    () =>
      [...chatSessions]
        .filter((c) => c.closedAt)
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [chatSessions]
  )

  // Auto-select the first open tab (chat or terminal) if none selected
  useEffect(() => {
    if (!selectedChatId && openTabs.length > 0) {
      onSelectChat(openTabs[0].id)
    }
  }, [selectedChatId, openTabs, onSelectChat])

  const activeTab = selectedChatId ?? openTabs[0]?.id ?? ""
  const chatHistoryPr = useLatestPr(activeTab)
  const displayPr: { url: string; number: string } | null =
    chatHistoryPr ??
    (branchPr ? { url: branchPr.url, number: String(branchPr.number) } : null)
  const isAgentBusy = agent
    ? agent.status === "creating" || agent.status === "starting"
    : false
  const allChatIds = useMemo(
    () => chatSessions.map((c) => c.id),
    [chatSessions]
  )
  const anyChatStreaming = useAnyChatStreaming(allChatIds)
  const [showLogs, setShowLogs] = useState(false)
  const tabsValue = showLogs ? LOGS_TAB_VALUE : activeTab

  // Sticky new-tab action. Read the last-used kind from localStorage during
  // render (SSR-safe — `readLastTabKind` returns "chat" when `window` is
  // undefined) rather than syncing it in via an effect, which would trigger a
  // cascading render on mount. `onCreateTerminal` is absent for layer targets,
  // so the sticky kind can only ever be "terminal" when terminals are actually
  // creatable here.
  const [lastTabKind, setLastTabKind] = useState<TabKind>(readLastTabKind)
  const stickyTabKind: TabKind =
    onCreateTerminal && lastTabKind === "terminal" ? "terminal" : "chat"

  // The harnesses installed in this deployment's sandboxes — the menu the caret
  // draws (#290). Only fetched when terminals are creatable here (agent target).
  const { data: session } = useSession()
  const userId = session?.user.id
  const installedHarnesses = useInstalledHarnesses(!!onCreateTerminal)

  // The harness the sticky "+" launches when its kind is "terminal": the
  // operator's last pick if it's still installed, else the first installed
  // harness, else the catalog default (list not loaded yet / none installed).
  // Read per-User from localStorage during render — a hint only, never
  // authoritative (a tab's harness lives on its `terminal_tab.harnessKey` row),
  // so a stale value can't change an existing tab. A harness pick flips
  // `lastTabKind` (a state update), which re-renders and re-reads this fresh.
  const storedHarnessKey = userId ? readLastHarnessKey(userId) : null
  const defaultHarnessKey =
    storedHarnessKey &&
    installedHarnesses.some((h) => h.key === storedHarnessKey)
      ? storedHarnessKey
      : (installedHarnesses[0]?.key ?? DEFAULT_HARNESS_KEY)
  const defaultHarnessLabel = installedHarnesses.find(
    (h) => h.key === defaultHarnessKey
  )?.label

  const createChatTab = useCallback(() => {
    setLastTabKind("chat")
    writeLastTabKind("chat")
    onCreateChat()
  }, [onCreateChat])

  // Launch a terminal with `harnessKey` and make it the sticky default: the "+"
  // button now repeats *this* harness, and (keyed per User) it survives reload.
  const createTerminalTab = useCallback(
    (harnessKey: string) => {
      setLastTabKind("terminal")
      writeLastTabKind("terminal")
      if (userId) writeLastHarnessKey(userId, harnessKey)
      onCreateTerminal?.(harnessKey)
    },
    [onCreateTerminal, userId]
  )

  // The sticky "+" action: repeat the last-used kind, and for terminals the
  // last-used (or default) harness.
  const createStickyTab = useCallback(() => {
    if (stickyTabKind === "terminal") createTerminalTab(defaultHarnessKey)
    else createChatTab()
  }, [stickyTabKind, defaultHarnessKey, createTerminalTab, createChatTab])

  // Reset the logs-visible flag whenever the chat target changes so a
  // freshly-selected target (whose LogsPanel is still fetching, if any)
  // doesn't inherit the previous target's "logs tab open" state. Done during
  // render via the previous-value pattern rather than in an effect, which
  // would cascade an extra render after the target switch.
  const targetKey = agent?.id ?? layerTarget?.layer.id ?? ""
  const [lastTargetKey, setLastTargetKey] = useState(targetKey)
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey)
    setShowLogs(false)
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

  const handleCreatePr = () => {
    if (!activeTab) return
    inputStore.send(
      activeTab,
      "Create a pull request for the changes on this branch."
    )
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
                  className="group"
                >
                  <GitPullRequest />#{displayPr.number}
                  <ArrowUpRight className="opacity-60 group-hover:opacity-100" />
                </a>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={handleCreatePr}
                disabled={!activeTab || isAgentBusy || anyChatStreaming}
                title={
                  isAgentBusy
                    ? "Sandbox still starting…"
                    : anyChatStreaming
                      ? "Agent is working on this branch…"
                      : undefined
                }
              >
                <GitPullRequest />
                Create PR
              </Button>
            ))}
        </div>
      </div>
      <div className="flex border-b border-border bg-background">
        <ScrollArea orientation="horizontal" className="min-w-0 flex-1">
          <TabsList variant="line" className="h-9 px-2">
            {isAgentTarget && (
              <TabsTrigger
                value={LOGS_TAB_VALUE}
                className="shrink-0 px-1.5"
                aria-label="Sandbox logs"
                title="Sandbox logs"
              >
                <Logs className="size-3.5" />
              </TabsTrigger>
            )}
            {openTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="group/tab relative min-w-[100px] px-2 py-1 pr-2 text-xs"
              >
                {tab.kind === "terminal" ? (
                  <TerminalTabLabel terminal={tab.terminal} />
                ) : (
                  <ChatTabLabel chat={tab.chat} />
                )}
                <div className="absolute top-0 right-0 bottom-0 flex items-center bg-[var(--background)] pr-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100">
                  <div className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)]" />
                  <span
                    role="button"
                    tabIndex={0}
                    title="Rename"
                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      const newLabel = prompt("Rename chat", tab.label)
                      if (newLabel?.trim())
                        onRenameChat(tab.id, newLabel.trim())
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        const newLabel = prompt("Rename chat", tab.label)
                        if (newLabel?.trim())
                          onRenameChat(tab.id, newLabel.trim())
                      }
                    }}
                  >
                    <Pencil className="size-3" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Close"
                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseChat(tab.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        onCloseChat(tab.id)
                      }
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </div>
              </TabsTrigger>
            ))}
            {onCreateTerminal ? (
              <ButtonGroup
                className={`${isAgentBusy ? "" : "group/newtab"} ml-1 shrink-0`}
              >
                <TooltipProvider delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
                        onClick={createStickyTab}
                        disabled={isAgentBusy}
                        aria-label={
                          stickyTabKind === "terminal"
                            ? defaultHarnessLabel
                              ? `New ${defaultHarnessLabel} terminal`
                              : "New terminal"
                            : "New chat"
                        }
                      >
                        <Plus className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isAgentBusy
                        ? "Sandbox still starting…"
                        : stickyTabKind === "terminal"
                          ? defaultHarnessLabel
                            ? `New ${defaultHarnessLabel} terminal`
                            : "New terminal"
                          : "New chat"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="w-4 min-w-0 px-0 opacity-0 group-focus-within/newtab:opacity-100 group-hover/newtab:bg-muted group-hover/newtab:text-foreground group-hover/newtab:opacity-100 group-has-[[aria-expanded=true]]/newtab:bg-muted group-has-[[aria-expanded=true]]/newtab:text-foreground in-data-[slot=button-group]:rounded-md aria-expanded:opacity-100 dark:group-hover/newtab:bg-muted/50 dark:group-has-[[aria-expanded=true]]/newtab:bg-muted/50"
                      disabled={isAgentBusy}
                      title="New chat or terminal"
                      aria-label="New chat or terminal"
                    >
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => createChatTab()}>
                      <MessageCircle className="size-3 shrink-0 text-muted-foreground" />
                      New chat
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {installedHarnesses.length > 0 ? (
                      <>
                        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                          New terminal
                        </DropdownMenuLabel>
                        {installedHarnesses.map((h) => (
                          <DropdownMenuItem
                            key={h.key}
                            onSelect={() => createTerminalTab(h.key)}
                          >
                            <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{h.label}</span>
                            {stickyTabKind === "terminal" &&
                              h.key === defaultHarnessKey && (
                                <Check className="ml-auto size-3 shrink-0" />
                              )}
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : (
                      // List not loaded yet (or no harnesses installed) — keep a
                      // single working "New terminal" that opens the default
                      // harness, so the menu never strands the operator.
                      <DropdownMenuItem
                        onSelect={() => createTerminalTab(DEFAULT_HARNESS_KEY)}
                      >
                        <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
                        New terminal
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-1 shrink-0"
                onClick={onCreateChat}
                disabled={isAgentBusy}
                title={isAgentBusy ? "Sandbox still starting…" : "New chat"}
              >
                <Plus className="size-3" />
              </Button>
            )}
          </TabsList>
        </ScrollArea>
        {closedChats.length > 0 && (
          <div className="flex shrink-0 items-center px-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" title="Closed chats">
                  <Archive className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {closedChats.map((chat) => (
                  <DropdownMenuItem
                    key={chat.id}
                    className="flex items-center gap-2"
                    onSelect={() => onReopenChat(chat.id)}
                  >
                    <RotateCcw className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{chat.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {agent && (
        <TabsContent
          value={LOGS_TAB_VALUE}
          className="flex-1 overflow-hidden data-[state=inactive]:hidden"
          forceMount
        >
          <LogsPanel
            sandboxName={agent.sandboxName}
            onConnected={handleLogsConnected}
          />
        </TabsContent>
      )}

      {openTabs.map((tab) => {
        // A terminal tab renders the in-sandbox web terminal, not the Engine
        // chat — its scrollback never enters the conversation model. It's keyed
        // by its own id (the shared live-view session) so a second client in
        // the room co-views the same live PTY.
        if (tab.kind === "terminal") {
          return (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="flex-1 overflow-hidden data-[state=inactive]:hidden"
              forceMount
            >
              <TerminalTab
                sessionId={tab.terminal.terminalSessionId}
                roomId={roomId}
                sandboxName={agent?.sandboxName}
                sandboxStatus={agent?.status}
                harnessKey={tab.terminal.harnessKey}
              />
            </TabsContent>
          )
        }
        const chat = tab.chat
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
            className="flex-1 overflow-hidden data-[state=inactive]:hidden"
            forceMount
          >
            <AgentChat
              chatId={chat.id}
              roomId={roomId}
              sandboxId={agent?.id}
              sandboxName={agent?.sandboxName}
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
            />
          </TabsContent>
        )
      })}
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
          <CommandInput placeholder="Search branches and layers..." />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {pickableAgents.length > 0 && (
              <CommandGroup heading="Branches">
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
