"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Check, ChevronDown, Trash2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { GripSpinner } from "@/components/grip-spinner"
import { formatRelative } from "@/components/canvas/comments"
import { chatStore } from "@/lib/chat-store"
import type { ChatSessionData } from "@/lib/types"

// History rows load their chat's log to show its first line, so cap how many a
// single open fetches.
const HISTORY_LIMIT = 20

function useChatRunState(chatId: string) {
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

/** The text of a chat's first user message, once its log has loaded. */
function useFirstLine(chatId: string): string | null {
  return useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => {
      const first = chatStore
        .getSnapshot(chatId)
        .messages.find((m) => m.role === "user")
      return first && first.role === "user" ? first.content : null
    },
    () => null
  )
}

/** True when any of `chatIds` has a finished run nobody has looked at yet. */
function useAnyUnread(chatIds: string[]): boolean {
  const key = chatIds.join(",")
  return useSyncExternalStore(
    (cb) => {
      const unsubs = key
        ? key.split(",").map((id) => chatStore.subscribe(id, cb))
        : []
      return () => unsubs.forEach((u) => u())
    },
    () => (key ? key.split(",").some((id) => chatStore.hasUnread(id)) : false),
    () => false
  )
}

/** The dot or spinner in front of a chat's name, shared with the tab strip. */
export function ChatRunIndicator({ chatId }: { chatId: string }) {
  const { isStreaming, hasUnread } = useChatRunState(chatId)
  if (isStreaming)
    return <GripSpinner className="size-3 shrink-0 text-muted-foreground" />
  if (hasUnread)
    return (
      <span
        aria-label="Unread"
        className="size-1.5 shrink-0 rounded-full bg-blue-500"
      />
    )
  return null
}

function OpenChatRow({
  chat,
  isActive,
  onSelect,
}: {
  chat: ChatSessionData
  isActive: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
    >
      <span className="flex w-3 shrink-0 justify-center">
        <ChatRunIndicator chatId={chat.id} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {chat.label || "Untitled"}
      </span>
      {isActive && <Check className="size-3.5 shrink-0" />}
    </button>
  )
}

function HistoryRow({
  chat,
  onReopen,
  onDelete,
}: {
  chat: ChatSessionData
  onReopen: () => void
  onDelete: () => void
}) {
  const firstLine = useFirstLine(chat.id)
  const { isStreaming } = useChatRunState(chat.id)
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="group/row relative flex items-start rounded-md hover:bg-accent has-[button:focus-visible]:bg-accent">
      <button
        type="button"
        onClick={onReopen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left outline-none"
      >
        <span className="flex items-center gap-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">
            {chat.label || "Untitled"}
          </span>
          {isStreaming ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <GripSpinner className="size-3" />
              Running
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-hover/row:invisible group-has-[button:focus-visible]/row:invisible">
              {formatRelative(chat.closedAt || chat.createdAt)}
            </span>
          )}
        </span>
        <span className="truncate pr-6 text-xs text-muted-foreground">
          {firstLine ?? "No messages"}
        </span>
      </button>
      {/* Delete is permanent, so the first press only arms it. */}
      <Button
        variant={confirming ? "destructive" : "ghost"}
        size={confirming ? "xs" : "icon-xs"}
        aria-label={confirming ? "Confirm delete" : "Delete chat"}
        title={confirming ? undefined : "Delete chat"}
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
        className={cn(
          "absolute top-1 right-1 text-muted-foreground",
          !confirming &&
            "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
          isStreaming && !confirming && "hidden"
        )}
      >
        {confirming ? "Delete" : <Trash2 />}
      </Button>
    </div>
  )
}

/**
 * The chevron at the end of the chat tab strip: every open chat (so a tab the
 * strip had no room for is one click away) and the chat history. History rows
 * show when the chat was closed, its first message, whether it's still running,
 * and a delete.
 */
export function ChatHistoryMenu({
  openChats,
  overflowingIds,
  activeChatId,
  closedChats,
  onSelect,
  onReopen,
  onDelete,
}: {
  openChats: ChatSessionData[]
  /** Open chats the strip is hiding. A dot on the chevron flags their unread. */
  overflowingIds: Set<string>
  activeChatId: string
  /** Closed chats, newest first. */
  closedChats: ChatSessionData[]
  onSelect: (chatId: string) => void
  onReopen: (chatId: string) => void
  onDelete: (chatId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const history = closedChats.slice(0, HISTORY_LIMIT)
  const hiddenUnread = useAnyUnread(
    openChats.filter((c) => overflowingIds.has(c.id)).map((c) => c.id)
  )

  // Load each history row's log for its first line. Cached per chat, so
  // reopening the menu doesn't fetch again.
  const historyKey = history.map((c) => c.id).join(",")
  useEffect(() => {
    if (!open || !historyKey) return
    for (const id of historyKey.split(",")) chatStore.loadHistory(id)
  }, [open, historyKey])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="All chats"
          title="All chats"
          className="relative shrink-0 text-muted-foreground"
        >
          <ChevronDown className="size-3" />
          {hiddenUnread && (
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-blue-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-1">
        <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
          Open
        </div>
        {openChats.map((chat) => (
          <OpenChatRow
            key={chat.id}
            chat={chat}
            isActive={chat.id === activeChatId}
            onSelect={() => {
              onSelect(chat.id)
              setOpen(false)
            }}
          />
        ))}
        <div className="-mx-1 my-1 h-px bg-border" />
        <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
          History
        </div>
        {history.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            Chats you close show up here.
          </p>
        ) : (
          <div className="flex max-h-72 flex-col overflow-y-auto">
            {history.map((chat) => (
              <HistoryRow
                key={chat.id}
                chat={chat}
                onReopen={() => {
                  onReopen(chat.id)
                  setOpen(false)
                }}
                onDelete={() => onDelete(chat.id)}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
