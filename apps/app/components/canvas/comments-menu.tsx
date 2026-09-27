"use client"

import { useState } from "react"
import { MessageSquare } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import type { ThreadWithComments } from "@/lib/comments"

import { formatRelative, PillAvatar } from "./comments"

/**
 * The top bar's way into a Canvas's comments: the open-thread count, a dot
 * while any of them is unread, and a list of every open thread that jumps to
 * its pin. Resolved threads are left out, as they are on the canvas.
 */
export function CommentsMenu({
  threads,
  onSelectThread,
}: {
  threads: ThreadWithComments[]
  onSelectThread: (threadId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const openThreads = threads
    .filter((t) => !t.resolved)
    .sort((a, b) => lastActivity(b) - lastActivity(a))
  const unreadCount = openThreads.filter((t) => t.unread).length
  const label =
    `${openThreads.length} ${openThreads.length === 1 ? "comment" : "comments"}` +
    (unreadCount > 0 ? `, ${unreadCount} unread` : "")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={label}
                className="relative gap-1.5 px-2 tabular-nums"
              >
                <MessageSquare />
                {openThreads.length}
                {unreadCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1 left-5 size-1.5 rounded-full bg-info"
                  />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
          <span className="font-medium">Comments</span>
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {unreadCount} unread
            </span>
          )}
        </div>
        {openThreads.length === 0 ? (
          <p className="px-3 py-6 text-center text-balance text-muted-foreground">
            No comments yet. Press C to add one.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto p-1">
            {openThreads.map((thread) => (
              <li key={thread.id}>
                <ThreadRow
                  thread={thread}
                  onSelect={() => {
                    setOpen(false)
                    onSelectThread(thread.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ThreadRow({
  thread,
  onSelect,
}: {
  thread: ThreadWithComments
  onSelect: () => void
}) {
  const first = thread.comments[0]
  const replies = thread.comments.length - 1
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
    >
      <PillAvatar
        name={first?.authorName ?? "?"}
        avatar={first?.authorAvatar ?? null}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-medium">
            {first?.authorName ?? "Unknown"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelative(lastActivity(thread))}
          </span>
          {thread.unread && (
            <span
              aria-label="Unread"
              className="ml-auto size-1.5 shrink-0 self-center rounded-full bg-info"
            />
          )}
        </div>
        <p
          className={cn(
            "line-clamp-2 break-words",
            thread.unread ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {first?.body}
        </p>
        {replies > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {replies} {replies === 1 ? "reply" : "replies"}
          </p>
        )}
      </div>
    </button>
  )
}

function lastActivity(thread: ThreadWithComments): number {
  return thread.comments.at(-1)?.createdAt ?? thread.createdAt
}
