"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
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
import { IconButton } from "@workspace/ui/components/icon-button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
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
import { useAppSession } from "@/lib/auth-client"
import type { ElementAnchor, Placement } from "@/lib/comment-anchor"
import {
  appendCommentAction,
  createThreadAction,
  deleteCommentAction,
  deleteThreadAction,
  markThreadUnreadAction,
  setThreadResolvedAction,
} from "@/lib/comments-actions"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"
import { decodeAnchor, getLineNumbers } from "@/lib/document-comments"
import {
  setDocumentCommentRanges,
  type DocumentCommentRange,
} from "@/lib/document-comments-extension"
import { isLocalBuild } from "@/lib/local-mode"

import type { CommentThreads } from "./use-comment-threads"

/**
 * The one shape every comment pin takes — placed threads and the new-comment
 * anchor alike: a rounded bubble whose bottom-left corner is the point it
 * marks.
 */
const PIN_SHAPE = "rounded-2xl rounded-bl-xs"

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
  /** The element's anchor keys and the frame's path, from the bridge (#785). */
  anchor?: ElementAnchor | null
  route?: string | null
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
  /** The Workspace and shared route of each frame, by id: what a new frame
   *  comment is anchored to beyond its element (#785). */
  frameInfo?: ReadonlyMap<string, { branchId?: string; route?: string }>
  /** Where each open frame or document thread shows for this viewer (see
   *  `useCommentPlacements`). Only `pinned` threads get a pin. */
  placements: ReadonlyMap<string, Placement>
  /** Look up a registered markdown-layer editor by id — used to render inline
   *  highlights and project pin positions to the right margin. */
  getDocumentEditor?: (id: string) => Editor | undefined
  /** Bumped whenever a markdown-layer editor registers or unregisters so
   *  this component can re-run highlight / pin computations against the
   *  new set. */
  documentEditorsVersion?: number
  /** The Canvas's threads (see `useCommentThreads`), shared with the top
   *  bar's comment count and thread list. */
  commentThreads: CommentThreads
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

export function Comments({
  roomId,
  zoom,
  newCommentPos,
  onNewCommentPlaced,
  onCancelComment,
  iframeLayers,
  frameInfo,
  placements,
  getDocumentEditor,
  documentEditorsVersion,
  commentThreads,
  onSendToChat,
  activeThreadId: controlledActiveThreadId,
  onActivateThread,
}: CommentsProps) {
  const { data: session } = useAppSession()
  const { threads, markRead, setThreadUnread } = commentThreads
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

  // Inline doc-comment integration: push the active set of highlighted ranges
  // into each registered editor. (Their pins are placed by
  // `useCommentPlacements`, like frame pins.) Selection ranges drift through
  // doc edits via the plugin's decoration mapping in between refreshes, so
  // this doesn't need to re-run on every doc transaction.
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
  }, [threads, activeThreadId, getDocumentEditor, documentEditorsVersion])

  // Canvas position of a thread's pin: its placement (frame or document
  // threads, pinned for this viewer only) offset by the container's canvas
  // origin, or its stored point for a canvas-level thread.
  const threadPos = (
    t: ThreadWithComments
  ): { x: number; y: number } | null => {
    if (t.iframeLayerId || t.documentId) {
      const p = placements.get(t.id)
      if (p?.kind !== "pinned") return null
      const container = iframeLayerById.get(p.frameId)
      if (!container) return null
      return { x: container.x + p.x, y: container.y + p.y }
    }
    if (t.x === null || t.y === null) return null
    return { x: t.x, y: t.y }
  }

  // The composer sits at its click point, layer-local when it's on a frame or
  // document. Returns null until the container's canvas position is known.
  const composerCanvasPos = (() => {
    if (!newCommentPos) return null
    const containerId = newCommentPos.iframeLayerId ?? newCommentPos.documentId
    if (!containerId) return { x: newCommentPos.x, y: newCommentPos.y }
    const container = iframeLayerById.get(containerId)
    if (!container) return null
    return {
      x: container.x + newCommentPos.x,
      y: container.y + newCommentPos.y,
    }
  })()
  const composerFrame = newCommentPos?.iframeLayerId
    ? iframeLayerById.get(newCommentPos.iframeLayerId)
    : undefined
  const composerFrameInfo = newCommentPos?.iframeLayerId
    ? frameInfo?.get(newCommentPos.iframeLayerId)
    : undefined

  return (
    <>
      {threads
        .filter((t) => !t.resolved)
        .map((thread) => {
          const pos = threadPos(thread)
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
                if (open && thread.unread) markRead(thread.id)
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
          // Above every pin (they're siblings in the annotations layer).
          className="absolute z-2 size-0"
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
                {/* The pin this comment will become, in the author's own
                    avatar, so placing a comment previews its result. */}
                <div
                  aria-hidden
                  className={cn(
                    "absolute bottom-0 left-0 flex size-8 items-center justify-center bg-popover text-popover-foreground shadow-md ring-1 ring-border",
                    PIN_SHAPE
                  )}
                >
                  <PillAvatar
                    name={session?.user.name ?? "?"}
                    avatar={session?.user.image ?? null}
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                side="right"
                align="start"
                className="w-80"
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
                  frameAnchor={
                    newCommentPos.iframeLayerId
                      ? {
                          workspaceId: composerFrameInfo?.branchId ?? null,
                          // The frame's own report of its path, else the
                          // route the frame shows for everyone.
                          route:
                            newCommentPos.route ??
                            composerFrameInfo?.route ??
                            null,
                          anchor: newCommentPos.anchor ?? null,
                          viewportWidth: composerFrame?.width ?? null,
                          viewportHeight: composerFrame?.height ?? null,
                        }
                      : null
                  }
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
      // A hovered pin lifts over its neighbours, still under the composer.
      className="absolute size-0 hover:z-1"
      // The top bar's thread list finds a pin by this to bring it into view.
      data-comment-thread-id={thread.id}
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
                className={cn(
                  "absolute bottom-0 left-0 flex overflow-hidden shadow-md ring-1 transition-colors duration-200",
                  PIN_SHAPE,
                  thread.unread
                    ? "bg-info text-info-foreground ring-info hover:bg-info/90"
                    : "bg-popover text-popover-foreground ring-border hover:bg-accent"
                )}
                aria-label={`Open thread by ${firstComment?.authorName ?? "user"}${thread.unread ? " (unread)" : ""}`}
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

/** What a new frame comment is anchored to beyond its element path (#785). */
interface FrameAnchor {
  workspaceId: string | null
  route: string | null
  anchor: ElementAnchor | null
  viewportWidth: number | null
  viewportHeight: number | null
}

function NewThreadComposer({
  roomId,
  x,
  y,
  iframeLayerId,
  selector,
  offsetX,
  offsetY,
  frameAnchor,
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
  frameAnchor: FrameAnchor | null
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
      <Textarea
        autoFocus
        rows={3}
        className="max-h-40 resize-none"
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
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center">
          {/* Web: send-to-agent is the secondary, left-aligned action that
              sits alongside the primary "Comment" CTA. */}
          {onSendToChat && !isLocalBuild && (
            <SendToAgentTooltip>
              <Button
                size="sm"
                variant="ghost"
                onClick={sendToChat}
                disabled={pending || !body.trim()}
                className="gap-1 px-2"
              >
                <ArrowUp className="size-3.5" />
                Send to agent
              </Button>
            </SendToAgentTooltip>
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
          {isLocalBuild ? (
            onSendToChat && (
              <SendToAgentTooltip>
                <Button
                  size="sm"
                  onClick={sendToChat}
                  disabled={pending || !body.trim()}
                  className="gap-1"
                >
                  <ArrowUp className="size-3.5" />
                  Send to agent
                </Button>
              </SendToAgentTooltip>
            )
          ) : (
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
          ...frameAnchor,
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

export function ThreadView({
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
        <IconButton
          label="Resolve thread"
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
          <CheckCircle2 />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Thread actions">
              <MoreHorizontal />
            </IconButton>
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
        <Textarea
          rows={2}
          className="max-h-40 resize-none"
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
    <div className="mb-2 rounded-sm border-l-2 border-border bg-muted px-2 py-1.5 text-xs leading-snug text-muted-foreground">
      {range && (
        <div className="mb-0.5 font-medium text-foreground">{range}</div>
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
          <span className="text-xs text-muted-foreground">
            {formatRelative(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
          {comment.body}
        </p>
      </div>
      {currentUserId === comment.authorId && (
        <IconButton
          label="Delete comment"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
          <Trash2 />
        </IconButton>
      )}
    </div>
  )
}

export function PillAvatar({
  name,
  avatar,
}: {
  name: string
  avatar: string | null
}) {
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt={name} className="size-6 rounded-full" />
    )
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase()
  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
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
    <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {initial}
    </div>
  )
}

export function formatRelative(ts: number): string {
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

/** A styled tooltip for the composer's "Send to agent" action. */
function SendToAgentTooltip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom">
          Send as a message to the agent
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
