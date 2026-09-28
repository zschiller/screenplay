"use client"

import { useState } from "react"
import type { Editor } from "@tiptap/core"
import { ChevronLeft, MessageSquare } from "lucide-react"

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

import { useAppSession } from "@/lib/auth-client"
import type { Placement } from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"

import { formatRelative, PillAvatar, ThreadView } from "./comments"

/**
 * The top bar's way into a Canvas's comments: the open-thread count, a dot
 * while any of them is unread, and a list of every open thread that jumps to
 * its pin. Resolved threads are left out, as they are on the canvas.
 *
 * Detached threads (#785), whose frame or element is gone, have no pin to jump
 * to, so they're listed last with what they were on and open in the list
 * itself.
 */
export function CommentsMenu({
  threads,
  placements,
  onSelectThread,
  onOpenThread,
  onMarkUnread,
  getDocumentEditor,
}: {
  threads: ThreadWithComments[]
  /** Where each thread shows for this viewer (see `useCommentPlacements`). */
  placements: ReadonlyMap<string, Placement>
  onSelectThread: (threadId: string) => void
  /** A detached thread was opened in the list (mark it read). */
  onOpenThread: (threadId: string) => void
  onMarkUnread: (threadId: string) => void
  getDocumentEditor?: (id: string) => Editor | undefined
}) {
  const { data: session } = useAppSession()
  const [open, setOpen] = useState(false)
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const openThreads = threads
    .filter((t) => !t.resolved)
    .sort((a, b) => lastActivity(b) - lastActivity(a))
  const isDetached = (t: ThreadWithComments) =>
    placements.get(t.id)?.kind === "detached"
  const attached = openThreads.filter((t) => !isDetached(t))
  const detached = openThreads.filter(isDetached)
  const unreadCount = openThreads.filter((t) => t.unread).length
  const label =
    `${openThreads.length} ${openThreads.length === 1 ? "comment" : "comments"}` +
    (unreadCount > 0 ? `, ${unreadCount} unread` : "")
  const openThread = openThreadId
    ? openThreads.find((t) => t.id === openThreadId)
    : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setOpenThreadId(null)
      }}
    >
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
        {openThread ? (
          <>
            <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 px-1.5"
                onClick={() => setOpenThreadId(null)}
              >
                <ChevronLeft />
                Comments
              </Button>
            </div>
            <DetachedNote
              thread={openThread}
              placement={placements.get(openThread.id)}
              className="px-3 pt-2 pb-1"
            />
            <ThreadView
              thread={openThread}
              currentUserId={session?.user.id ?? null}
              getDocumentEditor={getDocumentEditor}
              onClose={() => setOpenThreadId(null)}
              onMarkUnread={() => {
                onMarkUnread(openThread.id)
                setOpenThreadId(null)
              }}
            />
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <span className="font-medium">Comments</span>
              {unreadCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {openThreads.length === 0 ? (
              <p className="px-3 py-6 text-center text-muted-foreground">
                No comments yet. Press C to add one.
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto p-1">
                <ul>
                  {attached.map((thread) => {
                    const p = placements.get(thread.id)
                    return (
                      <li key={thread.id}>
                        <ThreadRow
                          thread={thread}
                          detail={
                            p?.kind === "offRoute" ? (
                              <>
                                On <span className="font-mono">{p.route}</span>
                              </>
                            ) : null
                          }
                          onSelect={() => {
                            setOpen(false)
                            onSelectThread(thread.id)
                          }}
                        />
                      </li>
                    )
                  })}
                </ul>
                {detached.length > 0 && (
                  <>
                    <p className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                      Detached
                    </p>
                    <ul>
                      {detached.map((thread) => (
                        <li key={thread.id}>
                          <ThreadRow
                            thread={thread}
                            detail={
                              <DetachedNote
                                thread={thread}
                                placement={placements.get(thread.id)}
                              />
                            }
                            onSelect={() => {
                              setOpenThreadId(thread.id)
                              if (thread.unread) onOpenThread(thread.id)
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * What a detached comment was on, and why it has no pin: the element's
 * snapshot (or the quoted text, for a document), where it was, and whether its
 * frame or element is gone.
 */
function DetachedNote({
  thread,
  placement,
  className,
}: {
  thread: ThreadWithComments
  placement: Placement | undefined
  className?: string
}) {
  if (placement?.kind !== "detached") return null
  const what = thread.snapshot ?? thread.quotedText
  const where = thread.route
  const reason =
    placement.reason === "frame"
      ? thread.documentId
        ? "Document deleted"
        : "Frame deleted"
      : thread.documentId
        ? "Text removed"
        : "Element not found"
  return (
    <span className={cn("block text-xs text-muted-foreground", className)}>
      {reason}
      {where && (
        <>
          {" · "}
          <span className="font-mono">{where}</span>
        </>
      )}
      {what && (
        <span className="block truncate text-foreground/70">{what}</span>
      )}
    </span>
  )
}

function ThreadRow({
  thread,
  detail,
  onSelect,
}: {
  thread: ThreadWithComments
  /** A muted line under the comment: where it is, when that isn't in view. */
  detail?: React.ReactNode
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
        {detail && (
          <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
        )}
      </div>
    </button>
  )
}

function lastActivity(thread: ThreadWithComments): number {
  return thread.comments.at(-1)?.createdAt ?? thread.createdAt
}
