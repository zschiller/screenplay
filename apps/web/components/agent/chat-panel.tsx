"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Plus, Pencil, X, Archive, RotateCcw, PanelRightClose, ChevronsUpDown, Check, GitPullRequest, ArrowUpRight, Logs } from "lucide-react"
import { inputStore } from "@/lib/input-store"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Button } from "@workspace/ui/components/button"
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
import type { AgentData, ChatSessionData } from "@/lib/liveblocks.types"
import type { DiffStats } from "@/hooks/use-diff-stats"
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

interface ChatPanelProps {
  agent: AgentData
  agents: AgentData[]
  onSelectAgent: (id: string) => void
  chatSessions: ChatSessionData[]
  selectedChatId: string | null
  roomId: string
  onSelectChat: (chatId: string | null) => void
  onCreateChat: () => void
  onRenameChat: (chatId: string, label: string) => void
  onRemoveChat: (chatId: string) => void
  onCloseChat: (chatId: string) => void
  onReopenChat: (chatId: string) => void
  onSessionId: (chatId: string, sessionId: string) => void
  onBranchRename: (branch: string) => void
  onPlanModeChange: (chatId: string, planMode: boolean) => void
  onModelChange: (chatId: string, model: string) => void
  diffStats?: DiffStats
  onCollapse?: () => void
}

export function ChatPanel({
  agent,
  agents,
  onSelectAgent,
  chatSessions,
  selectedChatId,
  roomId,
  onSelectChat,
  onCreateChat,
  onRenameChat,
  onRemoveChat,
  onCloseChat,
  onReopenChat,
  onSessionId,
  onBranchRename,
  onPlanModeChange,
  onModelChange,
  diffStats,
  onCollapse,
}: ChatPanelProps) {
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
  const latestPr = useLatestPr(activeTab)
  const [showLogs, setShowLogs] = useState(false)
  const tabsValue = showLogs ? LOGS_TAB_VALUE : activeTab

  // Auto-open the logs tab when the sandbox enters (or is already in) a
  // starting state so users can watch install/boot output.
  const prevStatusRef = useRef<AgentData["status"] | null>(null)
  useEffect(() => {
    const prev = prevStatusRef.current
    const isStarting = agent.status === "starting" || agent.status === "creating"
    const wasStarting = prev === "starting" || prev === "creating"
    if (isStarting && !wasStarting) {
      setShowLogs(true)
    }
    prevStatusRef.current = agent.status
  }, [agent.status])

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
        <AgentPicker
          agents={agents}
          currentAgentId={agent.id}
          currentBranch={agent.branch}
          currentColorKey={agent.id}
          onSelect={onSelectAgent}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
            <span className="flex items-center gap-1 font-mono text-[10px]">
              <span className="text-green-700 dark:text-green-300">+{diffStats.additions}</span>
              <span className="text-red-700 dark:text-red-300">-{diffStats.deletions}</span>
            </span>
          )}
          {latestPr ? (
            <Button size="xs" variant="outline" asChild>
              <a
                href={latestPr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <GitPullRequest />
                #{latestPr.number}
                <ArrowUpRight className="opacity-60 group-hover:opacity-100" />
              </a>
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={handleCreatePr}
              disabled={!activeTab}
            >
              <GitPullRequest />
              Create PR
            </Button>
          )}
        </div>
      </div>
      <div className="flex border-b border-border bg-background">
        <div className="flex-1 overflow-x-auto min-w-0">
          <TabsList variant="line" className="h-9 px-2">
            <TabsTrigger
              value={LOGS_TAB_VALUE}
              className="shrink-0 px-1.5"
              aria-label="Sandbox logs"
              title="Sandbox logs"
            >
              <Logs className="size-3.5" />
            </TabsTrigger>
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
              title="New chat"
            >
              <Plus className="size-3" />
            </Button>
          </TabsList>
        </div>
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

      <TabsContent
        value={LOGS_TAB_VALUE}
        className="flex-1 overflow-hidden data-[state=inactive]:hidden"
        forceMount
      >
        <LogsPanel sandboxName={agent.sandboxName} />
      </TabsContent>

      {openChats.map((chat) => {
        const isFirst = !chatSessions.some(
          (c) => c.agentId === chat.agentId && c.id !== chat.id && c.sessionId,
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
              sandboxId={agent.id}
              sandboxName={agent.sandboxName}
              branch={agent.branch}
              sessionId={chat.sessionId}
              isFirstChat={isFirst}
              planMode={chat.planMode}
              onPlanModeChange={(pm) => onPlanModeChange(chat.id, pm)}
              model={chat.model}
              onModelChange={(m) => onModelChange(chat.id, m)}
              onSessionId={(sid) => onSessionId(chat.id, sid)}
              onBranchRename={onBranchRename}
              onChatRename={(label) => onRenameChat(chat.id, label)}
            />
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

function AgentPicker({
  agents,
  currentAgentId,
  currentBranch,
  currentColorKey,
  onSelect,
}: {
  agents: AgentData[]
  currentAgentId: string
  currentBranch: string
  currentColorKey: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const runnableAgents = agents.filter((a) => a.status === "running" && a.branch)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-0.5">
          <BranchBadge branch={currentBranch} colorKey={currentColorKey} className="text-[11px] py-0 px-1.5" />
          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="start">
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            <CommandEmpty>No branches found.</CommandEmpty>
            <CommandGroup>
              {runnableAgents.map((a) => (
                <CommandItem
                  key={a.id}
                  value={a.branch}
                  onSelect={() => {
                    onSelect(a.id)
                    setOpen(false)
                  }}
                >
                  <Check className={`shrink-0 ${a.id === currentAgentId ? "" : "opacity-0"}`} />
                  <BranchBadge branch={a.branch} colorKey={a.id} className="text-[11px] py-0 px-1.5" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
