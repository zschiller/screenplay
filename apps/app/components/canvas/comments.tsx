"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { motion } from "motion/react"
import { ArrowUp, CheckCircle2, MoreHorizontal, Trash2 } from "lucide-react"
import type { Editor } from "@tiptap/core"
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
  useCommentsReadRevision,
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
import { decodeAnchor, getLineNumbers } from "@/lib/document-comments"
import {
  setDocumentCommentRanges,
  type DocumentCommentRange,
} from "@/lib/document-comments-extension"
import { isLocalBuild } from "@/lib/local-mode"

interface IframeLayerPos {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface NewCommentPos {
  x: number
  y: number
  iframeLayerId?: string
  selector?: string | null
  offsetX?: number | null
  offsetY?: number | null
  /** Inline document-layer anchor (set when the user clicked the bubble
   *  "Comment" button on a text selection inside a doc layer). */
  documentId?: string | null
  anchorStart?: string | null
  anchorEnd?: string | null
  quotedText?: string | null
  lineFrom?: number | null
  lineTo?: number | null
}

export interface SendToChatContext {
  iframeLayerId?: string | null
  selector?: string | null
  documentId?: string | null
  quotedText?: string | null
  lineFrom?: number | null
  lineTo?: number | null
}

interface CommentsProps {
  roomId: string
  zoom: number
  newCommentPos: NewCommentPos | null
  onNewCommentPlaced: () => void
  onCancelComment: () => void
  iframeLayers: IframeLayerPos[]
  getIframeLayerDom?: (id: string) => ScreenplayDom | undefined
  /** Look up a registered markdown-layer editor by id — used to render inline
   *  highlights and project pin positions to the right margin. */
  getDocumentEditor?: (id: string) => Editor | undefined
  /** Bumped whenever a markdown-layer editor registers or unregisters so
   *  this component can re-run highlight / pin computations against the
   *  new set. */
  documentEditorsVersion?: number
  /**
   * Threads pre-fetched on the server so pins render on the first paint
   * without waiting for a client-side server action — that action otherwise
   * gets queued behind the iframeLayer's probeSandboxUrl polling and only
   * resolves once the iframe URL is up.
   */
  initialThreads?: ThreadWithComments[]
  /**
   * If provided, the new-thread composer shows a "Send to agent" secondary
   * CTA that hands the typed text + the picked element context off to the
   * agent chat instead of creating a comment thread.
   */
  onSendToChat?: (text: string, ctx: SendToChatContext) => void
  /** Open an existing thread by id — drives highlight clicks inside docs. */
  activeThreadId?: string | null
  onActivateThread?: (threadId: string | null) => void
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
  iframeLayers,
  getIframeLayerDom,
  getDocumentEditor,
  documentEditorsVersion,
  initialThreads,
  onSendToChat,
  activeThreadId: controlledActiveThreadId,
  onActivateThread,
}: CommentsProps) {
  const { data: session } = useSession()
  const [threads, setThreads] = useState<ThreadWithComments[]>(
    () => initialThreads ?? []
  )
  // Distinguishes "haven't fetched yet" from "fetched and got zero". Without
  // this, the prune effect would run with the initial empty array on first
  // render and wipe every yjs cached position before threads actually arrive.
  // Pre-fetched data from the server flips this immediately so pins render
  // on the very first paint.
  const [threadsLoaded, setThreadsLoaded] = useState(
    () => initialThreads !== undefined
  )
  const [internalActiveThreadId, setInternalActiveThreadId] = useState<
    string | null
  >(null)
  const activeThreadId =
    controlledActiveThreadId !== undefined
      ? controlledActiveThreadId
      : internalActiveThreadId
  const setActiveThreadId = useCallback(
    (id: string | null) => {
      if (onActivateThread) onActivateThread(id)
      else setInternalActiveThreadId(id)
    },
    [onActivateThread]
  )
  const revision = useCommentsRevision()
  // The acting user's own read-state doorbell. Bumped only when *this* user
  // marks a thread read/unread (possibly from another tab), so we refetch to
  // recompute unread without every client in the room refetching.
  const readRevision = useCommentsReadRevision(session?.user.id ?? null)

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
  }, [roomId, revision, readRevision])

  const pinScale = 1 / zoom
  const pinStyle = {
    position: "relative" as const,
    transform: `scale(${pinScale})`,
    transformOrigin: "bottom left" as const,
  }

  const iframeLayerById = useMemo(() => {
    const m = new Map<string, IframeLayerPos>()
    for (const a of iframeLayers) m.set(a.id, a)
    return m
  }, [iframeLayers])

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
  // Keep the latest snapshot in the ref (written after commit, not during
  // render) so the polling tick can read it without re-running on every yjs
  // update.
  useEffect(() => {
    trackedPositionsRef.current = trackedPositions
  })

  // Drop yjs entries for threads that no longer exist so the doc doesn't
  // grow forever as comments get resolved/deleted. Gated on the initial
  // fetch completing so we don't wipe everyone else's cached positions
  // during our own warm-up.
  useEffect(() => {
    if (!threadsLoaded) return
    pruneCommentPositions(new Set(threads.map((t) => t.id)))
  }, [threads, threadsLoaded, pruneCommentPositions])

  // Poll selector-anchored threads and update tracked positions. Each tick
  // sends one batched bridge call per iframeLayer (collapsing N round-trips
  // into one) and self-throttles via rAF — the next tick is scheduled only
  // after the previous batch resolves, so cadence tracks the channel's real
  // throughput instead of flooding it.
  useEffect(() => {
    if (!getIframeLayerDom) return
    let cancelled = false
    let rafId: number | null = null
    const anchored = threads.filter(
      (t) => !t.resolved && t.iframeLayerId && t.selector
    )
    if (anchored.length === 0) return

    // Group anchored threads by iframeLayer so we can issue one batched call
    // per iframe per tick.
    const byIframeLayer = new Map<string, typeof anchored>()
    for (const t of anchored) {
      const arr = byIframeLayer.get(t.iframeLayerId!)
      if (arr) arr.push(t)
      else byIframeLayer.set(t.iframeLayerId!, [t])
    }

    async function tick() {
      await Promise.all(
        Array.from(byIframeLayer.entries()).map(
          async ([iframeLayerId, group]) => {
            const dom = getIframeLayerDom!(iframeLayerId)
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
              // even as it resizes with iframeLayer / page reflow.
              const x = rect.x + (t.offsetX ?? 0) * rect.width
              const y = rect.y + (t.offsetY ?? 0) * rect.height
              // Compare against the current yjs cached position (or DB
              // fallback if we haven't cached one yet) to skip writes when
              // nothing meaningful changed.
              const cached = trackedPositionsRef.current.get(t.id)
              const baseX = cached?.x ?? t.x
              const baseY = cached?.y ?? t.y
              // baseX/baseY are nullable because branch-only threads have no
              // canvas position. listThreads filters those out, so this is
              // effectively unreachable for canvas threads — but be defensive
              // and just write the new position without diffing if we somehow
              // don't have a baseline.
              if (
                baseX === null ||
                baseY === null ||
                Math.hypot(x - baseX, y - baseY) > POSITION_DRIFT_PX
              ) {
                setCommentPosition(t.id, x, y)
              }
            }
          }
        )
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
  }, [threads, getIframeLayerDom, setCommentPosition])

  // Inline doc-comment integration: push the active set of highlighted
  // ranges into each registered editor, and project the corresponding pin
  // positions to the right margin of each doc tile so they share the same
  // canvas-pin model as artboard threads.
  //
  // The effect runs whenever the threads list, the active thread, or the
  // editor registry changes. Selection ranges drift through doc edits via
  // the plugin's decoration mapping in between refreshes, so we don't need
  // to re-run on every doc transaction.
  useEffect(() => {
    if (!getDocumentEditor) return
    const docThreads = threads.filter(
      (t) => !t.resolved && t.documentId && t.anchorStart && t.anchorEnd
    )
    const byDoc = new Map<string, ThreadWithComments[]>()
    for (const t of docThreads) {
      const arr = byDoc.get(t.documentId!)
      if (arr) arr.push(t)
      else byDoc.set(t.documentId!, [t])
    }
    const cleanups: Array<() => void> = []
    for (const [docId, group] of byDoc.entries()) {
      const editor = getDocumentEditor(docId)
      if (!editor || editor.isDestroyed) continue
      const ranges: DocumentCommentRange[] = []
      const layer = iframeLayerById.get(docId)
      const layerEl = editor.view.dom.closest(
        "[data-doc-id]"
      ) as HTMLElement | null
      const layerRect = layerEl?.getBoundingClientRect()
      for (const t of group) {
        const from = decodeAnchor(editor, t.anchorStart!)
        const to = decodeAnchor(editor, t.anchorEnd!)
        if (from === null || to === null || from >= to) continue
        ranges.push({
          id: t.id,
          from,
          to,
          active: activeThreadId === t.id,
        })
        // Project the pin to the right margin of the doc tile, vertically
        // aligned with the start of the highlighted range. The yjs comment
        // position is stored in *layer-local* canvas units (matching how
        // artboard threads store iframe-local coords), so resolvePos's
        // existing add-the-layer-origin path renders it correctly.
        if (layer && layerRect) {
          const fromCoords = editor.view.coordsAtPos(from)
          const localY = (fromCoords.top - layerRect.top) / zoom
          const x = layer.width
          const y = localY
          const cached = trackedPositionsRef.current.get(t.id)
          const baseX = cached?.x ?? t.x
          const baseY = cached?.y ?? t.y
          if (
            baseX === null ||
            baseY === null ||
            Math.hypot(x - baseX, y - baseY) > POSITION_DRIFT_PX
          ) {
            setCommentPosition(t.id, x, y)
          }
        }
      }
      setDocumentCommentRanges(editor.view, ranges)
      // On unmount/refresh, clear the highlights so a stale set doesn't
      // linger if the doc unmounts before the next push.
      cleanups.push(() => {
        if (editor.isDestroyed) return
        setDocumentCommentRanges(editor.view, [])
      })
    }
    return () => {
      for (const fn of cleanups) fn()
    }
  }, [
    threads,
    activeThreadId,
    getDocumentEditor,
    documentEditorsVersion,
    iframeLayerById,
    setCommentPosition,
    zoom,
  ])

  const resolvePos = useCallback(
    (t: {
      id?: string
      x: number | null
      y: number | null
      iframeLayerId?: string | null
      selector?: string | null
      documentId?: string | null
    }): { x: number; y: number } | null => {
      const containerId = t.iframeLayerId ?? t.documentId
      if (containerId) {
        const ab = iframeLayerById.get(containerId)
        // IframeLayers / markdown-layers data may load after threads (yjs
        // warm-up). Returning null makes the caller skip rendering until
        // the container's canvas
        // position is known, so the pin doesn't flash at iframe-local coords
        // mistakenly placed in canvas space.
        if (!ab) return null
        const tracked = t.id ? trackedPositions.get(t.id) : undefined
        // Either we have a tracked position from selector reflow, or we fall
        // back to the DB-stored x/y. Branch-only threads (no x/y) never reach
        // here because listThreads filters them out, but guard regardless.
        const local =
          tracked ?? (t.x !== null && t.y !== null ? { x: t.x, y: t.y } : null)
        if (!local) return null
        return { x: ab.x + local.x, y: ab.y + local.y }
      }
      if (t.x === null || t.y === null) return null
      return { x: t.x, y: t.y }
    },
    [iframeLayerById, trackedPositions]
  )

  const composerCanvasPos = newCommentPos ? resolvePos(newCommentPos) : null

  // Optimistically flip a thread's local unread state without waiting for a
  // listThreads refetch — keeps the pin color from flickering when opening
  // the popover or toggling from the menu.
  const setThreadUnread = useCallback((threadId: string, unread: boolean) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread } : t))
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
            <CommentPin
              key={thread.id}
              thread={thread}
              pos={pos}
              pinStyle={pinStyle}
              isOpen={activeThreadId === thread.id}
              currentUserId={session?.user.id ?? null}
              getDocumentEditor={getDocumentEditor}
              onOpenChange={(open) => {
                setActiveThreadId(open ? thread.id : null)
                if (open && thread.unread) {
                  setThreadUnread(thread.id, false)
                  markThreadReadAction(thread.id).catch((e) =>
                    console.error("markThreadRead failed:", e)
                  )
                }
              }}
              onClose={() => setActiveThreadId(null)}
              onMarkUnread={() => {
                setThreadUnread(thread.id, true)
                setActiveThreadId(null)
              }}
            />
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
                  iframeLayerId={newCommentPos.iframeLayerId}
                  selector={newCommentPos.selector ?? null}
                  offsetX={newCommentPos.offsetX ?? null}
                  offsetY={newCommentPos.offsetY ?? null}
                  documentId={newCommentPos.documentId ?? null}
                  anchorStart={newCommentPos.anchorStart ?? null}
                  anchorEnd={newCommentPos.anchorEnd ?? null}
                  quotedText={newCommentPos.quotedText ?? null}
                  lineFrom={newCommentPos.lineFrom ?? null}
                  lineTo={newCommentPos.lineTo ?? null}
                  onSubmitted={onNewCommentPlaced}
                  onCancel={onCancelComment}
                  onSendToChat={
                    // Send-to-agent survives only for document targets — a text
                    // selection (`documentId`) or a whole doc placed via
                    // comment mode (`iframeLayerId` naming a registered doc
                    // editor). The frame-element → owning-agent path is retired
                    // in favour of the composer token flow (#618), so a frame
                    // pin gets no send-to-agent action.
                    onSendToChat &&
                    (newCommentPos.documentId ||
                      (newCommentPos.iframeLayerId &&
                        getDocumentEditor?.(newCommentPos.iframeLayerId)))
                      ? (text) =>
                          onSendToChat(text, {
                            iframeLayerId: newCommentPos.iframeLayerId ?? null,
                            selector: newCommentPos.selector ?? null,
                            documentId: newCommentPos.documentId ?? null,
                            quotedText: newCommentPos.quotedText ?? null,
                            lineFrom: newCommentPos.lineFrom ?? null,
                            lineTo: newCommentPos.lineTo ?? null,
                          })
                      : undefined
                  }
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </>
  )
}

function CommentPin({
  thread,
  pos,
  pinStyle,
  isOpen,
  currentUserId,
  getDocumentEditor,
  onOpenChange,
  onClose,
  onMarkUnread,
}: {
  thread: ThreadWithComments
  pos: { x: number; y: number }
  pinStyle: { transform: string; transformOrigin: "bottom left" }
  isOpen: boolean
  currentUserId: string | null
  getDocumentEditor?: (id: string) => Editor | undefined
  onOpenChange: (open: boolean) => void
  onClose: () => void
  onMarkUnread: () => void
}) {
  const [hovered, setHovered] = useState(false)
  // Pin only expands while hovered AND popover is closed. Opening the
  // popover snaps the pin back to its 32×32 footprint so the popover
  // visually anchors to a stable point.
  const expanded = hovered && !isOpen
  const firstComment = thread.comments[0]
  return (
    <div
      className="absolute z-[100] size-0 hover:z-[101]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div style={pinStyle}>
        <Popover open={isOpen} onOpenChange={onOpenChange}>
          {/* Fixed-size trigger pinned to the collapsed pin footprint.
              Radix positions the popover against this stable rect, so the
              popover stays glued to the pin tip while the inner card
              hover-expands. Click bubbles from the inner button to this
              wrapper, which is what Radix wires open/close to. */}
          <PopoverTrigger asChild>
            <div
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto"
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                width: "2rem",
                height: "2rem",
              }}
            >
              <motion.button
                type="button"
                onHoverStart={() => setHovered(true)}
                onHoverEnd={() => setHovered(false)}
                animate={{
                  width: expanded ? 320 : 32,
                  height: expanded ? 64 : 32,
                  paddingLeft: expanded ? 8 : 0,
                  paddingRight: expanded ? 8 : 0,
                  paddingTop: expanded ? 12 : 0,
                  paddingBottom: expanded ? 12 : 0,
                  alignItems: expanded ? "flex-start" : "center",
                }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className={
                  "absolute bottom-0 left-0 flex overflow-hidden rounded-tl-[20px] rounded-tr-[20px] rounded-br-[20px] rounded-bl-[2px] shadow-md ring-1 transition-colors duration-200 " +
                  (thread.unread
                    ? "bg-blue-400 text-white ring-blue-500/30 hover:bg-blue-500"
                    : "bg-white text-neutral-900 ring-black/10 hover:bg-neutral-50")
                }
                aria-label={`Open thread by ${firstComment?.authorName ?? "user"}`}
              >
                <motion.div
                  className="flex size-8 shrink-0 justify-center"
                  animate={{ alignItems: expanded ? "flex-start" : "center" }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <PillAvatar
                    name={firstComment?.authorName ?? "?"}
                    avatar={firstComment?.authorAvatar ?? null}
                  />
                </motion.div>
                {firstComment && (
                  <motion.div
                    aria-hidden
                    className="pointer-events-none mr-4 ml-2 flex min-w-0 flex-col gap-0 text-left leading-tight"
                    animate={{ opacity: expanded ? 1 : 0 }}
                    transition={{
                      duration: 0.15,
                      ease: "easeOut",
                      delay: expanded ? 0.1 : 0,
                    }}
                  >
                    <div className="flex items-baseline gap-1.5 text-sm">
                      <span className="truncate font-semibold">
                        {firstComment.authorName}
                      </span>
                      <span className="shrink-0 opacity-60">
                        {formatRelative(firstComment.createdAt)}
                      </span>
                    </div>
                    <div className="truncate text-sm">{firstComment.body}</div>
                  </motion.div>
                )}
              </motion.button>
            </div>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            className="w-80 p-0"
            onPointerDownOutside={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            // Without this the popover auto-focuses the first focusable
            // element (the Resolve button), which fires the tooltip's
            // focus handler and pops it open every time the thread opens.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <ThreadView
              thread={thread}
              currentUserId={currentUserId}
              getDocumentEditor={getDocumentEditor}
              onClose={onClose}
              onMarkUnread={onMarkUnread}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

function NewThreadComposer({
  roomId,
  x,
  y,
  iframeLayerId,
  selector,
  offsetX,
  offsetY,
  documentId,
  anchorStart,
  anchorEnd,
  quotedText,
  lineFrom,
  lineTo,
  onSubmitted,
  onCancel,
  onSendToChat,
}: {
  roomId: string
  x: number
  y: number
  iframeLayerId?: string
  selector: string | null
  offsetX: number | null
  offsetY: number | null
  documentId?: string | null
  anchorStart?: string | null
  anchorEnd?: string | null
  quotedText?: string | null
  lineFrom?: number | null
  lineTo?: number | null
  onSubmitted: () => void
  onCancel: () => void
  onSendToChat?: (text: string) => void
}) {
  const [body, setBody] = useState("")
  const [pending, start] = useTransition()
  return (
    <>
      {quotedText && (
        <QuoteHeader
          quotedText={quotedText}
          lineFrom={lineFrom ?? null}
          lineTo={lineTo ?? null}
        />
      )}
      <textarea
        autoFocus
        rows={3}
        className="w-full resize-none rounded-sm border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          if (isLocalBuild) {
            // Desktop has no comment threads — plain Enter sends the
            // selection to the agent; Shift+Enter inserts a newline.
            if (!e.shiftKey && onSendToChat) {
              e.preventDefault()
              sendToChat()
            }
            return
          }
          // Web: Cmd/Ctrl+Enter creates the comment thread.
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center">
          {/* Web: send-to-agent is the secondary, left-aligned action that
              sits alongside the primary "Comment" CTA. */}
          {onSendToChat && !isLocalBuild && (
            <Button
              size="sm"
              variant="ghost"
              onClick={sendToChat}
              disabled={pending || !body.trim()}
              title="Send as a message to the agent"
              className="gap-1 px-2"
            >
              <ArrowUp className="size-3.5" />
              Send to agent
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          {/* Persisted comment threads are excluded from the local build
              (#417), so on desktop send-to-agent becomes the primary CTA;
              on web "Comment" stays primary and send-to-agent is the ghost
              button above. */}
          {isLocalBuild
            ? onSendToChat && (
                <Button
                  size="sm"
                  onClick={sendToChat}
                  disabled={pending || !body.trim()}
                  title="Send as a message to the agent"
                  className="gap-1"
                >
                  <ArrowUp className="size-3.5" />
                  Send to agent
                </Button>
              )
            : (
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={pending || !body.trim()}
                >
                  Comment
                </Button>
              )}
        </div>
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
          iframeLayerId,
          selector,
          offsetX,
          offsetY,
          documentId,
          anchorStart,
          anchorEnd,
          quotedText,
          body: text,
        })
        onSubmitted()
      } catch (e) {
        console.error("createThread failed:", e)
      }
    })
  }

  function sendToChat() {
    const text = body.trim()
    if (!text || !onSendToChat) return
    onSendToChat(text)
    onSubmitted()
  }
}

function ThreadView({
  thread,
  currentUserId,
  getDocumentEditor,
  onClose,
  onMarkUnread,
}: {
  thread: ThreadWithComments
  currentUserId: string | null
  getDocumentEditor?: (id: string) => Editor | undefined
  onClose: () => void
  onMarkUnread: () => void
}) {
  const [reply, setReply] = useState("")
  const [pending, start] = useTransition()
  const canDelete = currentUserId === thread.createdBy
  // Live line numbers — recomputed against the current doc each time the
  // popover opens so they reflect any edits since the thread was created.
  // Falls back to the snapshot quote with no range if the doc isn't
  // currently mounted.
  const liveLines = useDocCommentLines(thread, getDocumentEditor)
  return (
    <div className="flex flex-col">
      {thread.quotedText && (
        <div className="border-b border-border px-3 pt-2 pb-2">
          <QuoteHeader
            quotedText={thread.quotedText}
            lineFrom={liveLines?.lineFrom ?? null}
            lineTo={liveLines?.lineTo ?? null}
          />
        </div>
      )}
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
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                onMarkUnread()
                markThreadUnreadAction(thread.id).catch((e) =>
                  console.error("markThreadUnread failed:", e)
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
          <CommentRow key={c.id} comment={c} currentUserId={currentUserId} />
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

function QuoteHeader({
  quotedText,
  lineFrom,
  lineTo,
}: {
  quotedText: string
  lineFrom: number | null
  lineTo: number | null
}) {
  const range =
    lineFrom !== null && lineTo !== null
      ? lineFrom === lineTo
        ? `Line ${lineFrom}`
        : `Lines ${lineFrom}–${lineTo}`
      : null
  return (
    <div className="mb-2 rounded-sm border-l-2 border-yellow-500 bg-yellow-50 px-2 py-1.5 text-xs leading-snug text-foreground/80 dark:bg-yellow-500/10">
      {range && (
        <div className="mb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {range}
        </div>
      )}
      <div className="line-clamp-3 break-words whitespace-pre-wrap">
        {quotedText}
      </div>
    </div>
  )
}

function useDocCommentLines(
  thread: ThreadWithComments,
  getDocumentEditor?: (id: string) => Editor | undefined
): { lineFrom: number; lineTo: number } | null {
  return useMemo(() => {
    if (!thread.documentId || !thread.anchorStart || !thread.anchorEnd) {
      return null
    }
    if (!getDocumentEditor) return null
    const editor = getDocumentEditor(thread.documentId)
    if (!editor || editor.isDestroyed) return null
    const from = decodeAnchor(editor, thread.anchorStart)
    const to = decodeAnchor(editor, thread.anchorEnd)
    if (from === null || to === null) return null
    return getLineNumbers(editor.state.doc, from, to)
    // anchorStart/End are immutable per thread; deps just need the thread id
    // and the editor lookup (which closes over the latest registry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    thread.id,
    thread.documentId,
    thread.anchorStart,
    thread.anchorEnd,
    getDocumentEditor,
  ])
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
      <Avatar name={comment.authorName} avatar={comment.authorAvatar} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {comment.authorName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelative(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
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
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt={name} className="size-6 rounded-full" />
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
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt={name} className="mt-0.5 size-5 rounded-full" />
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
