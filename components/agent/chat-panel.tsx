"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { Plus, Pencil, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
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
  onSessionId,
  onBranchRename,
}: ChatPanelProps) {
  const sortedChats = useMemo(
    () => [...chatSessions].sort((a, b) => a.createdAt - b.createdAt),
    [chatSessions],
  )

  // Auto-select first chat if none selected
  useEffect(() => {
    if (!selectedChatId && sortedChats.length > 0) {
      onSelectChat(sortedChats[0].id)
    }
  }, [selectedChatId, sortedChats, onSelectChat])

  const activeTab = selectedChatId ?? sortedChats[0]?.id ?? ""

  return (
    <Tabs
      value={activeTab}
      onValueChange={onSelectChat}
      className="flex h-full flex-col gap-0"
    >
      <div className="border-b border-border overflow-x-auto">
        <TabsList variant="line" className="h-9 px-2">
          {sortedChats.map((chat) => (
            <TabsTrigger
              key={chat.id}
              value={chat.id}
              className="group/tab relative min-w-[100px] text-xs px-2 pr-2 py-1"
            >
              <ChatTabLabel chat={chat} />
              <div className="absolute right-0 top-0 bottom-0 flex items-center pr-0.5 opacity-0 group-hover/tab:opacity-100 transition-opacity bg-[var(--background)]">
                <div className="absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-[var(--background)] pointer-events-none" />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    const newLabel = prompt("Rename chat", chat.label)
                    if (newLabel?.trim()) onRenameChat(chat.id, newLabel.trim())
                  }}
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveChat(chat.id)
                  }}
                >
                  <X className="size-3" />
                </Button>
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

      {sortedChats.map((chat) => {
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
