"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Archive, Trash2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import { GripSpinner } from "@/components/grip-spinner"
import { formatRelative } from "@/components/canvas/comments"
import { chatStore } from "@/lib/chat-store"
import type { ChatSessionData } from "@/lib/types"

// History rows load their chat's log to show its first line, so cap how many a
// single open fetches.
const HISTORY_LIMIT = 20

function useIsStreaming(chatId: string): boolean {
  return useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId).isStreaming,
    () => false
  )
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
  const isStreaming = useIsStreaming(chat.id)
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="group/row relative flex items-start rounded-md hover:bg-accent has-[button:focus-visible]:bg-accent">
      <button
        type="button"
        onClick={onReopen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left outline-none"
      >
        <span className="flex items-center gap-2 text-sm">
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
      {confirming ? (
        <Button
          variant="destructive"
          size="xs"
          autoFocus
          onClick={onDelete}
          onBlur={() => setConfirming(false)}
          className="absolute top-1 right-1"
        >
          Delete
        </Button>
      ) : (
        !isStreaming && (
          <IconButton
            label="Delete chat"
            onClick={() => setConfirming(true)}
            className="absolute top-1 right-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 />
          </IconButton>
        )
      )}
    </div>
  )
}

/**
 * The chat history: the closed chats behind the tab strip's history button.
 * Each row shows the chat's name, when it was closed, its first message, and
 * whether it's still running; pressing a row reopens the chat, and a row can be
 * deleted.
 */
export function ChatHistoryMenu({
  closedChats,
  onReopen,
  onDelete,
}: {
  /** Closed chats, newest first. */
  closedChats: ChatSessionData[]
  onReopen: (chatId: string) => void
  onDelete: (chatId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const history = closedChats.slice(0, HISTORY_LIMIT)

  // Load each row's log for its first line. Cached per chat, so reopening the
  // menu doesn't fetch again.
  const historyKey = history.map((c) => c.id).join(",")
  useEffect(() => {
    if (!open || !historyKey) return
    for (const id of historyKey.split(",")) chatStore.loadHistory(id)
  }, [open, historyKey])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label="Chat history">
          <Archive className="size-3" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-1">
        <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
          History
        </div>
        <div className="flex max-h-80 flex-col overflow-y-auto">
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
      </PopoverContent>
    </Popover>
  )
}
