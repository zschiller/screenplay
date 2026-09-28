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

import { useNow } from "@/hooks/use-now"
import type { Placement } from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"

import {
  CommentPinMark,
  formatRelative,
  threadNumbers,
} from "./comment-thread-card"
import { OpenThreadCard, useRoomMembers, type CommentsProps } from "./comments"
import type { CommentThreads } from "./use-comment-threads"

/**
 * The top bar's way into a Canvas's comments: the open-thread count, a dot
 * while any of them is unread, and a list of every thread that jumps to its
 * pin. Resolved threads sit behind a second tab; opening one shows its pin
 * and card on the canvas until it's closed, where it can be reopened.
 *
 * Detached threads (#785), whose frame or element is gone, have no pin to jump
 * to, so they're listed last with what they were on and open in the list
 * itself.
 */
export function CommentsMenu({
  roomId,
  commentThreads,
  placements,
  onSelectThread,
  describeLayer,
  getDocumentEditor,
}: {
  roomId: string
  commentThreads: CommentThreads
  /** Where each thread shows for this viewer (see `useCommentPlacements`). */
  placements: ReadonlyMap<string, Placement>
  onSelectThread: (threadId: string) => void
  describeLayer?: CommentsProps["describeLayer"]
  getDocumentEditor?: (id: string) => Editor | undefined
}) {
  const { threads, markRead } = commentThreads
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"open" | "resolved">("open")
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const openThreads = threads
    .filter((t) => !t.resolved)
    .sort((a, b) => lastActivity(b) - lastActivity(a))
  const resolvedThreads = threads
    .filter((t) => t.resolved)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
  const isDetached = (t: ThreadWithComments) =>
    placements.get(t.id)?.kind === "detached"
  const shown =
    tab === "open" ? openThreads.filter((t) => !isDetached(t)) : resolvedThreads
  const detached = tab === "open" ? openThreads.filter(isDetached) : []
  // The same numbers the pins on the canvas carry.
  const numberById = threadNumbers(threads)
  const unreadCount = openThreads.filter((t) => t.unread).length
  const label =
    `${openThreads.length} ${openThreads.length === 1 ? "comment" : "comments"}` +
    (unreadCount > 0 ? `, ${unreadCount} unread` : "")
  const openThread = openThreadId
    ? threads.find((t) => t.id === openThreadId)
    : undefined
  const members = useRoomMembers(roomId, !!openThread)

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
                size="xs"
                aria-label={label}
                className="relative gap-1 px-1.5 font-normal tabular-nums"
              >
                <MessageSquare />
                {openThreads.length}
                {unreadCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1 left-4 size-1.5 rounded-full bg-info"
                  />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-0 p-0">
        {openThread ? (
          <>
            <div className="flex border-b border-border px-3 py-2">
              <button
                type="button"
                className="-ml-1 flex items-center gap-0.5 rounded-sm font-medium outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpenThreadId(null)}
              >
                <ChevronLeft className="size-4" />
                Comments
              </button>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {/* The card's chip already says where it was. */}
              <DetachedNote
                thread={openThread}
                placement={placements.get(openThread.id)}
                showRoute={false}
              />
              <OpenThreadCard
                thread={openThread}
                commentThreads={commentThreads}
                members={members}
                describeLayer={describeLayer}
                getDocumentEditor={getDocumentEditor}
                onClose={() => setOpenThreadId(null)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b border-border px-3 py-2">
              <span className="mr-auto font-medium">Comments</span>
              <TabButton
                selected={tab === "open"}
                onClick={() => setTab("open")}
              >
                Open
              </TabButton>
              <TabButton
                selected={tab === "resolved"}
                onClick={() => setTab("resolved")}
              >
                Resolved
                {resolvedThreads.length > 0 && (
                  <span className="text-muted-foreground tabular-nums">
                    {resolvedThreads.length}
                  </span>
                )}
              </TabButton>
            </div>
            {shown.length === 0 && detached.length === 0 ? (
              <p className="px-3 py-6 text-center text-balance text-muted-foreground">
                {tab === "open"
                  ? "No comments yet. Press C to add one."
                  : "No resolved comments."}
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto p-1">
                <ul>
                  {shown.map((thread) => {
                    const p = placements.get(thread.id)
                    return (
                      <li key={thread.id}>
                        <ThreadRow
                          thread={thread}
                          number={numberById.get(thread.id) ?? null}
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
                            number={numberById.get(thread.id) ?? null}
                            detail={
                              <DetachedNote
                                thread={thread}
                                placement={placements.get(thread.id)}
                              />
                            }
                            onSelect={() => {
                              setOpenThreadId(thread.id)
                              if (thread.unread) markRead(thread.id)
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
  showRoute = true,
  className,
}: {
  thread: ThreadWithComments
  placement: Placement | undefined
  showRoute?: boolean
  className?: string
}) {
  if (placement?.kind !== "detached") return null
  const what = thread.snapshot ?? thread.quotedText
  const where = showRoute ? thread.route : null
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

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "ghost"}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(!selected && "text-muted-foreground")}
    >
      {children}
    </Button>
  )
}

function ThreadRow({
  thread,
  number,
  detail,
  onSelect,
}: {
  thread: ThreadWithComments
  number: number | null
  /** A muted line under the comment: where it is, when that isn't in view. */
  detail?: React.ReactNode
  onSelect: () => void
}) {
  const now = useNow()
  const first = thread.comments[0]
  const replies = thread.comments.length - 1
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
    >
      <CommentPinMark
        number={number}
        unread={thread.unread}
        resolved={thread.resolved}
        className="shrink-0 shadow-none"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-medium">
            {first?.authorName ?? "Unknown"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelative(lastActivity(thread), now)}
          </span>
          {thread.unread && <span className="sr-only">Unread</span>}
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
