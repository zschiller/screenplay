"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { CheckCircle2, MoreHorizontal, Trash2 } from "lucide-react"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useSession } from "@/lib/auth-client"
import {
  useCommentPositions,
  useCommentsRevision,
  usePruneCommentPositions,
  useSetCommentPosition,
} from "@/lib/yjs/react"
import {
  appendCommentAction,
  createThreadAction,
  deleteCommentAction,
  deleteThreadAction,
  listThreadsAction,
  markThreadReadAction,
  markThreadUnreadAction,
  setThreadResolvedAction,
} from "@/lib/comments-actions"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"
import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"

interface ArtboardPos {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface NewCommentPos {
  x: number
  y: number
  artboardId?: string
  selector?: string | null
  offsetX?: number | null
  offsetY?: number | null
}

interface CommentsProps {
  roomId: string
  zoom: number
  newCommentPos: NewCommentPos | null
  onNewCommentPlaced: () => void
  onCancelComment: () => void
  artboards: ArtboardPos[]
  getArtboardDom?: (id: string) => ScreenplayDom | undefined
  /**
   * Threads pre-fetched on the server so pins render on the first paint
   * without waiting for a client-side server action — that action otherwise
   * gets queued behind the artboard's probeSandboxUrl polling and only
   * resolves once the iframe URL is up.
   */
  initialThreads?: ThreadWithComments[]
}

// How far the resolved position must drift from the cached value before we
// publish a new yjs update. Avoids spamming the doc on sub-pixel jitter.
const POSITION_DRIFT_PX = 4

export function Comments({
  roomId,
  zoom,
  newCommentPos,
  onNewCommentPlaced,
  onCancelComment,
  artboards,
  getArtboardDom,
  initialThreads,
}: CommentsProps) {
  const { data: session } = useSession()
  const [threads, setThreads] = useState<ThreadWithComments[]>(
    () => initialThreads ?? [],
  )
  // Distinguishes "haven't fetched yet" from "fetched and got zero". Without
  // this, the prune effect would run with the initial empty array on first
  // render and wipe every yjs cached position before threads actually arrive.
  // Pre-fetched data from the server flips this immediately so pins render
  // on the very first paint.
  const [threadsLoaded, setThreadsLoaded] = useState(
    () => initialThreads !== undefined,
  )
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const revision = useCommentsRevision()

  // Load + refetch on every revision bump (server-side notification channel).
  useEffect(() => {
    let cancelled = false
    listThreadsAction(roomId)
      .then((rows) => {
        if (cancelled) return
        setThreads(rows)
        setThreadsLoaded(true)
      })
      .catch((e) => console.error("listThreads failed:", e))
    return () => {
      cancelled = true
    }
  }, [roomId, revision])

  const pinScale = 1 / zoom
  const pinStyle = {
    transform: `scale(${pinScale})`,
    transformOrigin: "bottom left" as const,
  }

  const artboardById = useMemo(() => {
    const m = new Map<string, ArtboardPos>()
    for (const a of artboards) m.set(a.id, a)
    return m
  }, [artboards])

  // Live tracked-pin positions, read from the room's Yjs doc. Synced across
  // clients in realtime and persisted by the Yjs server, so a freshly-loaded
  // canvas can render every pin at its last-seen position without waiting
  // for the iframe / dev server / bridge.
  const trackedPositions = useCommentPositions()
  const setCommentPosition = useSetCommentPosition()
  const pruneCommentPositions = usePruneCommentPositions()
  // Latest snapshot for the polling tick to read without re-running on every
  // yjs update (the effect's deps are intentionally narrow).
  const trackedPositionsRef = useRef(trackedPositions)
  trackedPositionsRef.current = trackedPositions

  // Drop yjs entries for threads that no longer exist so the doc doesn't
  // grow forever as comments get resolved/deleted. Gated on the initial
  // fetch completing so we don't wipe everyone else's cached positions
  // during our own warm-up.
  useEffect(() => {
    if (!threadsLoaded) return
    pruneCommentPositions(new Set(threads.map((t) => t.id)))
  }, [threads, threadsLoaded, pruneCommentPositions])

  // Poll selector-anchored threads and update tracked positions. Each tick
  // sends one batched bridge call per artboard (collapsing N round-trips
  // into one) and self-throttles via rAF — the next tick is scheduled only
  // after the previous batch resolves, so cadence tracks the channel's real
  // throughput instead of flooding it.
  useEffect(() => {
    if (!getArtboardDom) return
    let cancelled = false
    let rafId: number | null = null
    const anchored = threads.filter(
      (t) => !t.resolved && t.artboardId && t.selector,
    )
    if (anchored.length === 0) return

    // Group anchored threads by artboard so we can issue one batched call
    // per iframe per tick.
    const byArtboard = new Map<string, typeof anchored>()
    for (const t of anchored) {
      const arr = byArtboard.get(t.artboardId!)
      if (arr) arr.push(t)
      else byArtboard.set(t.artboardId!, [t])
    }

    async function tick() {
      await Promise.all(
        Array.from(byArtboard.entries()).map(async ([artboardId, group]) => {
          const dom = getArtboardDom!(artboardId)
          if (!dom) return
          const selectors = group.map((t) => t.selector!)
          let rects: (DomRect | null)[]
          try {
            rects = await dom.getRectsForSelectors(selectors)
          } catch {
            return
          }
          for (let i = 0; i < group.length; i++) {
            const t = group[i]
            const rect = rects[i]
            if (!t || !rect) continue
            // Offsets are stored as fractions of the element's size at click
            // time, so the pin tracks the same relative point on the element
            // even as it resizes with artboard / page reflow.
            const x = rect.x + (t.offsetX ?? 0) * rect.width
            const y = rect.y + (t.offsetY ?? 0) * rect.height
            // Compare against the current yjs cached position (or DB
            // fallback if we haven't cached one yet) to skip writes when
            // nothing meaningful changed.
            const cached = trackedPositionsRef.current.get(t.id)
            const baseX = cached?.x ?? t.x
            const baseY = cached?.y ?? t.y
            if (Math.hypot(x - baseX, y - baseY) > POSITION_DRIFT_PX) {
              setCommentPosition(t.id, x, y)
            }
          }
        }),
      )
      if (cancelled) return
    }

    function loop() {
      if (cancelled) return
      tick().finally(() => {
        if (cancelled) return
        rafId = requestAnimationFrame(loop)
      })
    }
    loop()
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [threads, getArtboardDom, setCommentPosition])

  const resolvePos = useCallback(
    (t: {
      id?: string
      x: number
      y: number
      artboardId?: string | null
      selector?: string | null
    }): { x: number; y: number } | null => {
      if (t.artboardId) {
        const ab = artboardById.get(t.artboardId)
        // Artboards data may load after threads (yjs warm-up). Returning null
        // here makes the caller skip rendering until the artboard's canvas
        // position is known, so the pin doesn't flash at iframe-local coords
        // mistakenly placed in canvas space.
        if (!ab) return null
        const tracked = t.id ? trackedPositions.get(t.id) : undefined
        const local = tracked ?? { x: t.x, y: t.y }
        return { x: ab.x + local.x, y: ab.y + local.y }
      }
      return { x: t.x, y: t.y }
    },
    [artboardById, trackedPositions],
  )

  const composerCanvasPos = newCommentPos ? resolvePos(newCommentPos) : null

  // Optimistically flip a thread's local unread state without waiting for a
  // listThreads refetch — keeps the pin color from flickering when opening
  // the popover or toggling from the menu.
  const setThreadUnread = useCallback((threadId: string, unread: boolean) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread } : t)),
    )
  }, [])

  return (
    <>
      {threads
        .filter((t) => !t.resolved)
        .map((thread) => {
          const pos = resolvePos(thread)
          if (!pos) return null
          return (
            <div
              key={thread.id}
              className="absolute z-[100] size-0"
              style={{ left: pos.x, top: pos.y }}
            >
              <div style={pinStyle}>
                <Popover
                  open={activeThreadId === thread.id}
                  onOpenChange={(open) => {
                    setActiveThreadId(open ? thread.id : null)
                    if (open && thread.unread) {
                      setThreadUnread(thread.id, false)
                      markThreadReadAction(thread.id).catch((e) =>
                        console.error("markThreadRead failed:", e),
                      )
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      // Absolute positioning takes the button out of the
                      // wrapper's layout so the wrapper stays 0×0. That keeps
                      // the scale transform's "bottom left" origin pinned to
                      // the anchor point instead of drifting up by the
                      // button's height as zoom shrinks. The button hangs
                      // above the anchor with its bottom-left tip on it.
                      className={
                        "absolute bottom-0 left-0 flex h-8 w-8 items-center justify-center rounded-tl-[16px] rounded-tr-[16px] rounded-br-[16px] rounded-bl-[2px] shadow-md ring-1 " +
                        (thread.unread
                          ? "bg-blue-400 ring-blue-500/30 hover:bg-blue-500"
                          : "bg-white ring-black/10 hover:bg-neutral-50")
                      }
                      aria-label={`Open thread by ${thread.comments[0]?.authorName ?? "user"}`}
                    >
                      <PillAvatar
                        name={thread.comments[0]?.authorName ?? "?"}
                        avatar={thread.comments[0]?.authorAvatar ?? null}
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    className="w-80 p-0"
                    onPointerDownOutside={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    // Without this the popover auto-focuses the first
                    // focusable element (the Resolve button), which fires
                    // the tooltip's focus handler and pops it open every
                    // time the thread opens.
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <ThreadView
                      thread={thread}
                      currentUserId={session?.user.id ?? null}
                      onClose={() => setActiveThreadId(null)}
                      onMarkUnread={() => {
                        setThreadUnread(thread.id, true)
                        setActiveThreadId(null)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )
        })}

      {newCommentPos && composerCanvasPos && (
        <div
          className="absolute z-[100] size-0"
          style={{ left: composerCanvasPos.x, top: composerCanvasPos.y }}
        >
          <div style={pinStyle}>
            <Popover
              open
              onOpenChange={(open) => {
                if (!open) onCancelComment()
              }}
            >
              <PopoverAnchor asChild>
                <div
                  aria-hidden
                  className="absolute bottom-0 left-0 h-8 w-8 rounded-tl-[16px] rounded-tr-[16px] rounded-br-[16px] rounded-bl-[2px] bg-blue-500 shadow-md ring-1 ring-blue-600/30"
                />
              </PopoverAnchor>
              <PopoverContent
                side="right"
                align="start"
                className="w-72"
                onPointerDownOutside={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                <NewThreadComposer
                  roomId={roomId}
                  x={newCommentPos.x}
                  y={newCommentPos.y}
                  artboardId={newCommentPos.artboardId}
                  selector={newCommentPos.selector ?? null}
                  offsetX={newCommentPos.offsetX ?? null}
                  offsetY={newCommentPos.offsetY ?? null}
                  onSubmitted={onNewCommentPlaced}
                  onCancel={onCancelComment}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </>
  )
}

function NewThreadComposer({
  roomId,
  x,
  y,
  artboardId,
  selector,
  offsetX,
  offsetY,
  onSubmitted,
  onCancel,
}: {
  roomId: string
  x: number
  y: number
  artboardId?: string
  selector: string | null
  offsetX: number | null
  offsetY: number | null
  onSubmitted: () => void
  onCancel: () => void
}) {
  const [body, setBody] = useState("")
  const [pending, start] = useTransition()
  return (
    <>
      <textarea
        autoFocus
        rows={3}
        className="w-full resize-none rounded-sm border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
          Comment
        </Button>
      </div>
    </>
  )

  function submit() {
    const text = body.trim()
    if (!text) return
    start(async () => {
      try {
        await createThreadAction({
          roomId,
          x,
          y,
          artboardId,
          selector,
          offsetX,
          offsetY,
          body: text,
        })
        onSubmitted()
      } catch (e) {
        console.error("createThread failed:", e)
      }
    })
  }
}

function ThreadView({
  thread,
  currentUserId,
  onClose,
  onMarkUnread,
}: {
  thread: ThreadWithComments
  currentUserId: string | null
  onClose: () => void
  onMarkUnread: () => void
}) {
  const [reply, setReply] = useState("")
  const [pending, start] = useTransition()
  const canDelete = currentUserId === thread.createdBy
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label="Resolve thread"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await setThreadResolvedAction({
                        threadId: thread.id,
                        resolved: true,
                      })
                      onClose()
                    } catch (e) {
                      console.error("resolveThread failed:", e)
                    }
                  })
                }
              >
                <CheckCircle2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Resolve thread</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label="Thread actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onSelect={() => {
                onMarkUnread()
                markThreadUnreadAction(thread.id).catch((e) =>
                  console.error("markThreadUnread failed:", e),
                )
              }}
            >
              Mark as unread
            </DropdownMenuItem>
            {canDelete && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  start(async () => {
                    try {
                      await deleteThreadAction(thread.id)
                      onClose()
                    } catch (e) {
                      console.error("deleteThread failed:", e)
                    }
                  })
                }
              >
                Delete thread
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {thread.comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
          />
        ))}
      </div>
      <div className="border-t border-border p-2">
        <textarea
          rows={2}
          className="w-full resize-none rounded-sm border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submitReply()
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            onClick={submitReply}
            disabled={pending || !reply.trim()}
          >
            Reply
          </Button>
        </div>
      </div>
    </div>
  )

  function submitReply() {
    const text = reply.trim()
    if (!text) return
    start(async () => {
      try {
        await appendCommentAction({ threadId: thread.id, body: text })
        setReply("")
      } catch (e) {
        console.error("appendComment failed:", e)
      }
    })
  }
}

function CommentRow({
  comment,
  currentUserId,
}: {
  comment: CommentRecord
  currentUserId: string | null
}) {
  const [pending, start] = useTransition()
  return (
    <div className="group flex items-start gap-2 py-2">
      <Avatar
        name={comment.authorName}
        avatar={comment.authorAvatar}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {comment.authorName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelative(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
          {comment.body}
        </p>
      </div>
      {currentUserId === comment.authorId && (
        <Button
          size="icon"
          variant="ghost"
          className="size-6 opacity-0 group-hover:opacity-100"
          aria-label="Delete comment"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await deleteCommentAction({ commentId: comment.id })
              } catch (e) {
                console.error("deleteComment failed:", e)
              }
            })
          }
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </div>
  )
}

function PillAvatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatar}
        alt={name}
        className="size-6 rounded-full"
      />
    )
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase()
  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
      {initial}
    </div>
  )
}

function Avatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatar}
        alt={name}
        className="mt-0.5 size-5 rounded-full"
      />
    )
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase()
  return (
    <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
      {initial}
    </div>
  )
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return "just now"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(ts).toLocaleDateString()
}
