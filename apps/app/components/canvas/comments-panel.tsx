"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import {
  ChevronLeft,
  Eye,
  EyeOff,
  MessageSquare,
  MessageSquareOff,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { useNow } from "@/hooks/use-now"
import { useAppSession } from "@/lib/auth-client"
import type { Placement } from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"
import {
  filterThreads,
  groupThreads,
  lastActivity,
  type CommentFilter,
} from "@/lib/comments-panel"

import {
  CommentPinMark,
  formatRelative,
  threadNumbers,
} from "./comment-thread-card"
import { OpenThreadCard, useRoomMembers, type CommentsProps } from "./comments"
import type { CommentThreads } from "./use-comment-threads"

/**
 * The top bar's way into a Canvas's comments: the open-thread count, with a
 * dot while any of them is unread. It toggles the comments panel, and its
 * icon crosses out while pins are hidden.
 */
export function CommentsButton({
  threads,
  open,
  pinsHidden,
  onToggle,
}: {
  threads: readonly ThreadWithComments[]
  open: boolean
  pinsHidden: boolean
  onToggle: () => void
}) {
  const openThreads = threads.filter((t) => !t.resolved)
  const unreadCount = openThreads.filter((t) => t.unread).length
  const label =
    `${openThreads.length} ${openThreads.length === 1 ? "comment" : "comments"}` +
    (unreadCount > 0 ? `, ${unreadCount} unread` : "") +
    (pinsHidden ? ", pins hidden" : "")
  const Icon = pinsHidden ? MessageSquareOff : MessageSquare
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={open ? "secondary" : "ghost"}
            size="xs"
            aria-label={label}
            aria-pressed={open}
            onClick={onToggle}
            className="relative gap-1 px-1.5 font-normal tabular-nums"
          >
            <Icon />
            {openThreads.length}
            {unreadCount > 0 && (
              <span
                aria-hidden
                className="absolute top-1 left-4 size-1.5 rounded-full bg-info"
              />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const FILTERS: { id: CommentFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "unread", label: "Unread" },
  { id: "resolved", label: "Resolved" },
]

/**
 * Every thread on the Canvas, grouped by the frame and route (or document)
 * it's on, behind Open / Mine / Unread / Resolved filters. Choosing a thread
 * brings its pin into view and opens its card; J and K step through the list
 * the same way and E resolves (or, under Resolved, reopens) the chosen one.
 * The eye in the header shows or hides the pins on the canvas.
 *
 * Detached threads (#785), whose frame or element is gone, have no pin to go
 * to, so they're listed last with what they were on and open in the panel
 * itself.
 */
export function CommentsPanel({
  roomId,
  commentThreads,
  placements,
  activeThreadId,
  onSelectThread,
  pinsHidden,
  onPinsHiddenChange,
  onClose,
  describeLayer,
  getDocumentEditor,
}: {
  roomId: string
  commentThreads: CommentThreads
  /** Where each thread shows for this viewer (see `useCommentPlacements`). */
  placements: ReadonlyMap<string, Placement>
  /** The thread whose card is open on the canvas, if any. */
  activeThreadId: string | null
  /** Bring a thread's pin into view and open its card. */
  onSelectThread: (threadId: string) => void
  pinsHidden: boolean
  onPinsHiddenChange: (hidden: boolean) => void
  onClose: () => void
  describeLayer: NonNullable<CommentsProps["describeLayer"]>
  getDocumentEditor?: (id: string) => Editor | undefined
}) {
  const { threads, markRead, setResolved } = commentThreads
  const { data: session } = useAppSession()
  const userId = session?.user.id ?? null
  const [filter, setFilter] = useState<CommentFilter>("open")
  const [selectedId, setSelectedId] = useState<string | null>(activeThreadId)
  const [openDetachedId, setOpenDetachedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // A pin opened on the canvas becomes the panel's selection too, so J and K
  // carry on from it.
  const [seenActiveId, setSeenActiveId] = useState(activeThreadId)
  if (activeThreadId !== seenActiveId) {
    setSeenActiveId(activeThreadId)
    if (activeThreadId) setSelectedId(activeThreadId)
  }

  const groups = useMemo(
    () =>
      groupThreads(
        filterThreads(threads, filter, userId),
        placements,
        describeLayer
      ),
    [threads, filter, userId, placements, describeLayer]
  )
  const ordered = useMemo(() => groups.flatMap((g) => g.threads), [groups])
  const detachedThreads = useMemo(
    () => new Set(groups.filter((g) => g.detached).flatMap((g) => g.threads)),
    [groups]
  )
  // The same numbers the pins on the canvas carry.
  const numberById = useMemo(() => threadNumbers(threads), [threads])
  const counts: Partial<Record<CommentFilter, number>> = {
    open: filterThreads(threads, "open", userId).length,
    unread: filterThreads(threads, "unread", userId).length,
    resolved: filterThreads(threads, "resolved", userId).length,
  }

  const select = (thread: ThreadWithComments) => {
    setSelectedId(thread.id)
    if (detachedThreads.has(thread)) {
      if (thread.unread) markRead(thread.id)
    } else {
      onSelectThread(thread.id)
    }
  }

  // J / K / E, wherever focus is, unless it's in a text field.
  const onListKey = useEffectEvent((e: KeyboardEvent) => {
    if (openDetachedId) return
    const index = ordered.findIndex((t) => t.id === selectedId)
    if (e.key === "j" || e.key === "k") {
      if (ordered.length === 0) return
      const step = e.key === "j" ? 1 : -1
      const next =
        index === -1
          ? step === 1
            ? 0
            : ordered.length - 1
          : Math.min(ordered.length - 1, Math.max(0, index + step))
      e.preventDefault()
      const thread = ordered[next]
      if (thread && thread.id !== selectedId) select(thread)
      return
    }
    if (e.key === "e") {
      const thread = ordered[index]
      if (!thread) return
      e.preventDefault()
      setResolved(thread.id, !thread.resolved)
      // It leaves this filter's list: move on to the one after it.
      const after = ordered[index + 1] ?? ordered[index - 1]
      if (after) select(after)
      else setSelectedId(null)
    }
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (isEditable(e.target)) return
      onListKey(e)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Keep the chosen row in view as J and K move through a long list.
  useEffect(() => {
    if (!selectedId) return
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-panel-thread-id="${CSS.escape(selectedId)}"]`
      )
      ?.scrollIntoView({ block: "nearest" })
  }, [selectedId])

  const openDetached = openDetachedId
    ? threads.find((t) => t.id === openDetachedId)
    : undefined
  const members = useRoomMembers(roomId, !!openDetached)

  return (
    <div
      role="region"
      aria-label="Comments"
      // Hangs 4px under the top-right pill, lined up with its right edge, on
      // the popover surface the thread list used before it became a panel.
      className="pointer-events-auto absolute top-11 right-2 bottom-2 z-(--z-canvas-chrome) flex w-80 animate-in flex-col overflow-hidden rounded-lg bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 fade-in-0"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !openDetached) {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {openDetached ? (
        <>
          <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
            <button
              type="button"
              className="-ml-1 flex items-center gap-0.5 rounded-sm font-medium outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpenDetachedId(null)}
            >
              <ChevronLeft className="size-4" />
              Comments
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {/* The card's chip already says where it was. */}
            <DetachedNote
              thread={openDetached}
              placement={placements.get(openDetached.id)}
              showRoute={false}
            />
            <OpenThreadCard
              thread={openDetached}
              commentThreads={commentThreads}
              members={members}
              describeLayer={describeLayer}
              getDocumentEditor={getDocumentEditor}
              onClose={() => setOpenDetachedId(null)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
            <span className="mr-auto font-medium">Comments</span>
            <IconButton
              label={pinsHidden ? "Show pins" : "Hide pins"}
              tooltipSide="bottom"
              pressed={pinsHidden}
              onClick={() => onPinsHiddenChange(!pinsHidden)}
            >
              {pinsHidden ? <EyeOff /> : <Eye />}
            </IconButton>
            <IconButton
              label="Close"
              shortcut={["Esc"]}
              tooltipSide="bottom"
              onClick={onClose}
            >
              <X />
            </IconButton>
          </div>
          <div
            role="group"
            aria-label="Filter"
            className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-1.5"
          >
            {FILTERS.map((f) => (
              <FilterButton
                key={f.id}
                selected={filter === f.id}
                count={counts[f.id]}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </FilterButton>
            ))}
          </div>
          {ordered.length === 0 ? (
            <p className="px-3 py-6 text-center text-balance text-muted-foreground">
              {emptyText(filter, threads.length > 0)}
            </p>
          ) : (
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
              {groups.map((group) => (
                <section key={group.key} aria-label={groupLabel(group)}>
                  <p className="flex min-w-0 items-baseline gap-1 px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {group.detached ? (
                      "Detached"
                    ) : (
                      <>
                        <span className="truncate">{group.title}</span>
                        {group.route && (
                          <span className="shrink-0 font-mono font-normal">
                            {group.route}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                  <ul>
                    {group.threads.map((thread) => (
                      <li key={thread.id}>
                        <ThreadRow
                          thread={thread}
                          number={numberById.get(thread.id) ?? null}
                          selected={thread.id === selectedId}
                          detail={
                            group.detached ? (
                              <DetachedNote
                                thread={thread}
                                placement={placements.get(thread.id)}
                              />
                            ) : null
                          }
                          onSelect={() => {
                            select(thread)
                            if (group.detached) setOpenDetachedId(thread.id)
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function emptyText(filter: CommentFilter, any: boolean): string {
  if (!any) return "No comments yet. Press C to add one."
  switch (filter) {
    case "open":
      return "No open comments."
    case "mine":
      return "No open comments from you."
    case "unread":
      return "You're all caught up."
    case "resolved":
      return "No resolved comments."
  }
}

function groupLabel(group: ReturnType<typeof groupThreads>[number]) {
  if (group.detached) return "Detached"
  return group.route ? `${group.title} ${group.route}` : (group.title ?? "")
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

function FilterButton({
  selected,
  count,
  onClick,
  children,
}: {
  selected: boolean
  count?: number
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
      {count !== undefined && count > 0 && (
        <span className="text-muted-foreground tabular-nums">{count}</span>
      )}
    </Button>
  )
}

function ThreadRow({
  thread,
  number,
  selected,
  detail,
  onSelect,
}: {
  thread: ThreadWithComments
  number: number | null
  selected: boolean
  /** A muted line under the comment: why a detached one has no pin. */
  detail?: React.ReactNode
  onSelect: () => void
}) {
  const now = useNow()
  const first = thread.comments[0]
  const replies = thread.comments.length - 1
  return (
    <button
      type="button"
      data-panel-thread-id={thread.id}
      aria-current={selected || undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent",
        selected && "bg-accent"
      )}
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
