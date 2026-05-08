"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Plus, Pencil, X, Archive, RotateCcw, PanelRightClose, ChevronsUpDown, Check, GitPullRequest, ArrowUpRight, Logs } from "lucide-react"
import { inputStore } from "@/lib/input-store"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { BranchBadge } from "@/components/branch-badge"
import type { AgentData, ChatSessionData, DocumentLayerData } from "@/lib/types"
import { CHAT_TARGETABLE_LAYER_KINDS, getLayerKind } from "@/lib/layer-kinds"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"
import { chatStore } from "@/lib/chat-store"

const LOGS_TAB_VALUE = "__sandbox_logs__"

function useLatestPr(chatId: string): { url: string; number: string } | null {
  const messages = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).messages,
    () => [],
  )
  return useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "tool_result" && m.name === "create_pr") {
        const url = m.output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
        const num = m.output.match(/#(\d+)/)?.[1]
        if (url && num) return { url, number: num }
      }
    }
    return null
  }, [messages])
}

function useAnyChatStreaming(chatIds: string[]): boolean {
  const key = chatIds.join(",")
  const subscribe = useCallback(
    (cb: () => void) => {
      const unsubs = chatIds.map((id) => chatStore.subscribe(id, cb))
      return () => unsubs.forEach((u) => u())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  const getSnapshot = useCallback(
    () => chatIds.some((id) => chatStore.getSnapshot(id).isStreaming),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

function useChatStatus(chatId: string) {
  const isStreaming = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).isStreaming,
    () => false,
  )
  const hasUnread = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.hasUnread(chatId),
    () => false,
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
      <span className="truncate max-w-[100px]">{chat.label}</span>
    </span>
  )
}

/**
 * The chat panel can target one of two top-level kinds:
 *  - an *agent* (sandbox-backed flow): file editing, git, PR creation, logs.
 *  - a *layer* of any kind whose `LayerKindDescriptor.canBeChatTarget` is
 *    true (currently just documents). The `layerKind` discriminator
 *    determines which descriptor's icon/label drives the chrome and which
 *    server-side toolset runs.
 *
 * New layer kinds become valid chat targets by setting
 * `canBeChatTarget: true` on their descriptor and registering a server-side
 * `chat-target-kinds` entry — no changes here needed.
 */
export type ChatPanelTarget =
  | { kind: "agent"; agent: AgentData }
  | { kind: "layer"; layerKind: string; layer: { id: string } & Record<string, unknown> }

interface ChatPanelProps {
  target: ChatPanelTarget
  agents: AgentData[]
  documents: DocumentLayerData[]
  onSelectAgent: (id: string) => void
  /** Generalised "pick a layer-kind target" callback — receives the kind
   *  ("document", future kinds, …) and the layer id. */
  onSelectLayer: (layerKind: string, layerId: string) => void
  chatSessions: ChatSessionData[]
  selectedChatId: string | null
  roomId: string
  onSelectChat: (chatId: string | null) => void
  onCreateChat: () => void
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
  documents,
  onSelectAgent,
  onSelectLayer,
  chatSessions,
  selectedChatId,
  roomId,
  onSelectChat,
  onCreateChat,
  onRenameChat,
  onRemoveChat,
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
  // Layer-kind targets (currently just documents) are routed through the
  // shared `LayerKindDescriptor` registry; the chrome (target pill,
  // picker entry) reads icon/label from there so future kinds light up
  // without changes to this file.
  const layerTarget = target.kind === "layer" ? target : null
  const openChats = useMemo(
    () =>
      [...chatSessions]
        .filter((c) => !c.closedAt)
        .sort((a, b) => a.createdAt - b.createdAt),
    [chatSessions],
  )

  const closedChats = useMemo(
    () =>
      [...chatSessions]
        .filter((c) => c.closedAt)
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [chatSessions],
  )

  // Auto-select first open chat if none selected
  useEffect(() => {
    if (!selectedChatId && openChats.length > 0) {
      onSelectChat(openChats[0].id)
    }
  }, [selectedChatId, openChats, onSelectChat])

  const activeTab = selectedChatId ?? openChats[0]?.id ?? ""
  const chatHistoryPr = useLatestPr(activeTab)
  const displayPr: { url: string; number: string } | null =
    chatHistoryPr ??
    (branchPr ? { url: branchPr.url, number: String(branchPr.number) } : null)
  const isAgentBusy = agent ? (agent.status === "creating" || agent.status === "starting") : false
  const allChatIds = useMemo(
    () => chatSessions.map((c) => c.id),
    [chatSessions],
  )
  const anyChatStreaming = useAnyChatStreaming(allChatIds)
  const [showLogs, setShowLogs] = useState(false)
  const tabsValue = showLogs ? LOGS_TAB_VALUE : activeTab

  // Reset the logs-visible flag whenever the chat target changes so a
  // freshly-selected target (whose LogsPanel is still fetching, if any)
  // doesn't inherit the previous target's "logs tab open" state.
  const targetKey = agent?.id ?? layerTarget?.layer.id ?? ""
  useEffect(() => {
    setShowLogs(false)
  }, [targetKey])

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
    if (agent && (prev === "creating" || prev === "starting") && agent.status === "running") {
      setShowLogs(false)
    }
    prevStatusRef.current = agent?.status
  }, [agent])

  const handleCreatePr = () => {
    if (!activeTab) return
    inputStore.send(activeTab, "Create a pull request for the changes on this branch.")
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
            documents={documents}
            target={target}
            onSelectAgent={onSelectAgent}
            onSelectLayer={onSelectLayer}
          />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Diff stats and the PR button are agent-only — there's no
              git/branch concept for a doc target. */}
          {isAgentTarget && diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <span className="text-green-700 dark:text-green-300">+{diffStats.additions}</span>
              <span className="text-red-700 dark:text-red-300">-{diffStats.deletions}</span>
            </span>
          )}
          {isAgentTarget && (displayPr ? (
            <Button size="xs" variant="outline" asChild>
              <a
                href={displayPr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <GitPullRequest />
                #{displayPr.number}
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
        <ScrollArea orientation="horizontal" className="flex-1 min-w-0">
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
            {openChats.map((chat) => (
              <TabsTrigger
                key={chat.id}
                value={chat.id}
                className="group/tab relative min-w-[100px] text-xs px-2 pr-2 py-1"
              >
                <ChatTabLabel chat={chat} />
                <div className="absolute right-0 top-0 bottom-0 flex items-center pr-0.5 opacity-0 group-hover/tab:opacity-100 transition-opacity bg-[var(--background)]">
                  <div className="absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)] pointer-events-none" />
                  <span
                    role="button"
                    tabIndex={0}
                    title="Rename"
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      const newLabel = prompt("Rename chat", chat.label)
                      if (newLabel?.trim()) onRenameChat(chat.id, newLabel.trim())
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        const newLabel = prompt("Rename chat", chat.label)
                        if (newLabel?.trim()) onRenameChat(chat.id, newLabel.trim())
                      }
                    }}
                  >
                    <Pencil className="size-3" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Close"
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseChat(chat.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        onCloseChat(chat.id)
                      }
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </div>
              </TabsTrigger>
            ))}
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 ml-1"
              onClick={onCreateChat}
              disabled={isAgentBusy}
              title={isAgentBusy ? "Sandbox still starting…" : "New chat"}
            >
              <Plus className="size-3" />
            </Button>
          </TabsList>
        </ScrollArea>
        {closedChats.length > 0 && (
          <div className="flex shrink-0 items-center px-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Closed chats"
                >
                  <Archive className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {closedChats.map((chat, i) => (
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
          <LogsPanel sandboxName={agent.sandboxName} onConnected={handleLogsConnected} />
        </TabsContent>
      )}

      {openChats.map((chat) => {
        // First chat for this target — drives auto branch/chat naming on the
        // agent flow; for doc chats it's just used to skip naming logic.
        const isFirst = !chatSessions.some(
          (c) =>
            c.id !== chat.id &&
            ((chat.agentId && c.agentId === chat.agentId) ||
              (chat.documentId && c.documentId === chat.documentId)),
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
              branch={agent?.branch}
              documentId={layerTarget?.layerKind === "document" ? layerTarget.layer.id : undefined}
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
        branch={target.agent.branch}
        colorKey={target.agent.id}
        className="text-[11px] py-0 px-1.5"
      />
    )
  }
  const descriptor = getLayerKind(target.layerKind)
  if (!descriptor) return null
  const Icon = descriptor.Icon
  const label = descriptor.getLabel(target.layer as never)
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[14rem]">{label}</span>
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
  documents,
  target,
  onSelectAgent,
  onSelectLayer,
}: {
  agents: AgentData[]
  /** All chat-targetable layers, keyed by kind. The picker renders one
   *  CommandGroup per kind in registry order. */
  documents: DocumentLayerData[]
  target: ChatPanelTarget
  onSelectAgent: (id: string) => void
  onSelectLayer: (layerKind: string, layerId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pickableAgents = agents.filter((a) => a.branch && a.status !== "error" && a.status !== "stopped")

  // For now there's only one layer kind that's chat-targetable
  // (documents). Future kinds add their lookup here next to `documents`.
  const layersByKind: Record<string, Array<{ id: string } & Record<string, unknown>>> = {
    document: documents,
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
                  const isBusy = a.status === "creating" || a.status === "starting"
                  const isCurrent = target.kind === "agent" && a.id === target.agent.id
                  return (
                    <CommandItem
                      key={a.id}
                      value={`branch ${a.branch}`}
                      onSelect={() => {
                        onSelectAgent(a.id)
                        setOpen(false)
                      }}
                    >
                      <Check className={`shrink-0 ${isCurrent ? "" : "opacity-0"}`} />
                      <BranchBadge branch={a.branch} colorKey={a.id} className="text-[11px] py-0 px-1.5" />
                      {isBusy && <Spinner className="ml-auto size-3" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {CHAT_TARGETABLE_LAYER_KINDS.map((descriptor) => {
              const items = layersByKind[descriptor.kind] ?? []
              if (items.length === 0) return null
              const Icon = descriptor.Icon
              return (
                <CommandGroup key={descriptor.kind} heading={descriptor.pluralLabel}>
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
                        <Check className={`shrink-0 ${isCurrent ? "" : "opacity-0"}`} />
                        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
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

