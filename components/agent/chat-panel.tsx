"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { Plus, Pencil, X, Archive, RotateCcw } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AgentChat } from "./agent-chat"
import type { AgentData, ChatSessionData } from "@/lib/liveblocks.types"
import { chatStore } from "@/lib/chat-store"

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
}

export function ChatPanel({
  agent,
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

  return (
    <Tabs
      value={activeTab}
      onValueChange={onSelectChat}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex border-b border-border">
        <div className="flex-1 overflow-x-auto min-w-0">
          <TabsList variant="line" className="h-9 px-2">
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
