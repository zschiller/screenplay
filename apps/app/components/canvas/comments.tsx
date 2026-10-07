"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@workspace/ui/components/popover"
import { Button } from "@workspace/ui/components/button"
import { useAppSession } from "@/lib/auth-client"
import type { ThreadWithComments } from "@/lib/comments"
import { selectorLabel } from "@/lib/comment-element-label"
import { listCollaborators } from "@/lib/rooms-actions"
import {
  isFrameThread,
  type ElementAnchor,
  type Placement,
} from "@/lib/comment-anchor"
import { decodeAnchor, getLineNumbers } from "@/lib/document-comments"
import {
  setDocumentCommentRanges,
  type DocumentCommentRange,
} from "@/lib/document-comments-extension"
import { multiUserSurface } from "@/lib/capabilities"

import {
  CommentPinMark,
  ComposerFooter,
  MentionTextarea,
  PlaceChip,
  ThreadCard,
  threadNumbers,
  type CommentMember,
} from "./comment-thread-card"
import type { CommentThreads } from "./use-comment-threads"
import type { CommentRequests } from "./use-comment-requests"

export { formatRelative, PillAvatar } from "./comment-thread-card"

/** The pin's size in screen pixels; its bottom-left tip is the point. */
const PIN_PX = 26

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
  /** The element's anchor keys and the frame's path, from the bridge (#785). */
  anchor?: ElementAnchor | null
  route?: string | null
}

/** What a new comment on a frame is anchored to beyond its element. */
export interface FrameInfo {
  /** The Workspace the frame shows. */
  branchId?: string
  /** The route the frame shows, when it can't report its own path. */
  route?: string
  /**
   * The canvas frame a comment made here is stored against, when that isn't
   * the frame's key here: the player (#789) is one frame keyed by itself, and
   * stores the canvas frame it was opened from, or none.
   */
  storedLayerId?: string | null
}

export interface CommentsProps {
  roomId: string
  zoom: number
  newCommentPos: NewCommentPos | null
  onNewCommentPlaced: () => void
  onCancelComment: () => void
  iframeLayers: IframeLayerPos[]
  /** The Workspace and shared route of each frame, by id: what a new frame
   *  comment is anchored to beyond its element (#785). */
  frameInfo?: ReadonlyMap<string, FrameInfo>
  /** Where each open frame or document thread (and an active resolved one)
   *  shows for this viewer (see `useCommentPlacements`). Only `pinned`
   *  threads get a pin. */
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
  /** Open an existing thread by id — drives highlight clicks inside docs. */
  activeThreadId?: string | null
  onActivateThread?: (threadId: string | null) => void
  /** Names a frame or document layer for the thread card's chip. */
  describeLayer?: (id: string) => { title?: string; route?: string } | undefined
  /** Each thread's pin number, when `commentThreads` is a subset of the
   *  Canvas's threads (the player's, #789), so pins keep their canvas numbers. */
  numbers?: ReadonlyMap<string, number>
  /** Hide the pins (the comments panel's toggle), all but the open one's. */
  hidePins?: boolean
  /** Sending threads to their Workspace's agent (#788); the card offers it
   *  when given. */
  requests?: CommentRequests
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
  activeThreadId: controlledActiveThreadId,
  onActivateThread,
  describeLayer,
  numbers,
  hidePins = false,
  requests,
}: CommentsProps) {
  const { threads, markRead } = commentThreads
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
  // this doesn't need to re-run on every doc transaction. A passage the
  // composer is open on is held in the active colour too: the editor's own
  // selection stops painting once the composer takes focus.
  const draftDocumentId = newCommentPos?.documentId ?? null
  const draftAnchorStart = newCommentPos?.anchorStart ?? null
  const draftAnchorEnd = newCommentPos?.anchorEnd ?? null
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
    if (draftDocumentId && !byDoc.has(draftDocumentId)) {
      byDoc.set(draftDocumentId, [])
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
      if (docId === draftDocumentId && draftAnchorStart && draftAnchorEnd) {
        const from = decodeAnchor(editor, draftAnchorStart)
        const to = decodeAnchor(editor, draftAnchorEnd)
        if (from !== null && to !== null && from < to) {
          ranges.push({ id: "draft", from, to, pending: true })
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
    draftDocumentId,
    draftAnchorStart,
    draftAnchorEnd,
  ])

  // Canvas position of a thread's pin: its placement (frame or document
  // threads, pinned for this viewer only) offset by the container's canvas
  // origin, or its stored point for a canvas-level thread.
  const threadPos = (
    t: ThreadWithComments
  ): { x: number; y: number } | null => {
    if (isFrameThread(t) || t.documentId) {
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

  const ownNumbers = useMemo(() => threadNumbers(threads), [threads])
  const numberById = numbers ?? ownNumbers

  const activeThread = activeThreadId
    ? threads.find((t) => t.id === activeThreadId)
    : undefined
  const activePlacement = activeThreadId
    ? placements.get(activeThreadId)
    : undefined
  const activeRect =
    activePlacement?.kind === "pinned"
      ? (activePlacement.element ?? null)
      : null
  const members = useRoomMembers(
    roomId,
    multiUserSurface && (!!activeThread || !!newCommentPos)
  )

  return (
    <>
      {threads
        // A resolved thread leaves the canvas, but opening it from the
        // comments panel shows it until it's closed again. Hidden pins work
        // the same way.
        .filter((t) => t.id === activeThreadId || (!t.resolved && !hidePins))
        .map((thread) => {
          const pos = threadPos(thread)
          if (!pos) return null
          const isOpen = activeThreadId === thread.id
          const placement = placements.get(thread.id)
          const layer =
            placement?.kind === "pinned" && isFrameThread(thread)
              ? iframeLayerById.get(placement.frameId)
              : undefined
          const elementBox =
            isOpen && layer && activeRect
              ? {
                  x: layer.x + activeRect.x,
                  y: layer.y + activeRect.y,
                  width: activeRect.width,
                  height: activeRect.height,
                }
              : null
          return (
            <CommentPin
              key={thread.id}
              thread={thread}
              number={numberById.get(thread.id) ?? null}
              pos={pos}
              zoom={zoom}
              elementBox={elementBox}
              isOpen={isOpen}
              onOpenChange={(open) => {
                setActiveThreadId(open ? thread.id : null)
                if (open && thread.unread) markRead(thread.id)
              }}
            >
              <OpenThreadCard
                thread={thread}
                commentThreads={commentThreads}
                members={members}
                describeLayer={describeLayer}
                getDocumentEditor={getDocumentEditor}
                requests={requests}
                onClose={() => setActiveThreadId(null)}
              />
            </CommentPin>
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
                {/* The pin this comment will become, numbered as it will be,
                    so placing a comment previews its result. */}
                <div aria-hidden className="absolute bottom-0 left-0">
                  <CommentPinMark
                    number={multiUserSurface ? numberById.size + 1 : null}
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                side="right"
                align="start"
                className="w-[250px] p-3"
                onPointerDownOutside={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                <NewThreadComposer
                  createThread={commentThreads.createThread}
                  place={describePlace(
                    {
                      documentId: newCommentPos.documentId ?? null,
                      iframeLayerId: newCommentPos.iframeLayerId ?? null,
                      selector: newCommentPos.selector ?? null,
                      route: newCommentPos.route ?? null,
                    },
                    describeLayer
                  )}
                  members={members}
                  x={newCommentPos.x}
                  y={newCommentPos.y}
                  iframeLayerId={
                    composerFrameInfo &&
                    composerFrameInfo.storedLayerId !== undefined
                      ? (composerFrameInfo.storedLayerId ?? undefined)
                      : newCommentPos.iframeLayerId
                  }
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
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </>
  )
}

/** The thread card's chip: the route it was made on (else the frame's) and
 *  the element, or the document's title. */
function describePlace(
  thread: Pick<
    ThreadWithComments,
    "documentId" | "iframeLayerId" | "selector" | "route"
  >,
  describeLayer: CommentsProps["describeLayer"]
): string | null {
  const layerId = thread.documentId ?? thread.iframeLayerId
  const layer = layerId ? describeLayer?.(layerId) : undefined
  if (thread.documentId) return layer?.title || null
  const parts = [
    thread.route ?? layer?.route,
    selectorLabel(thread.selector),
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(" · ")
  return layer?.title || null
}

/**
 * An open thread's card, wired to the thread store: on the canvas beside its
 * pin, or in the comments menu for a detached thread that has no pin.
 */
export function OpenThreadCard({
  thread,
  commentThreads,
  members,
  describeLayer,
  getDocumentEditor,
  requests,
  onClose,
}: {
  thread: ThreadWithComments
  commentThreads: CommentThreads
  members: CommentMember[]
  describeLayer: CommentsProps["describeLayer"]
  getDocumentEditor?: (id: string) => Editor | undefined
  requests?: CommentRequests
  onClose: () => void
}) {
  const { data: session } = useAppSession()
  const { reply, editComment, markUnread, setResolved, deleteWithUndo } =
    commentThreads
  return (
    <ThreadCard
      thread={thread}
      place={describePlace(thread, describeLayer)}
      quote={
        thread.quotedText ? (
          <ThreadQuote thread={thread} getDocumentEditor={getDocumentEditor} />
        ) : undefined
      }
      currentUserId={session?.user.id ?? null}
      members={members}
      onResolve={() => {
        onClose()
        setResolved(thread.id, true)
      }}
      onReopen={() => setResolved(thread.id, false)}
      onSendToAgent={
        requests?.canSend(thread) ? () => requests.send([thread.id]) : undefined
      }
      onReply={(body) => reply(thread.id, body)}
      onEditComment={editComment}
      onMarkUnread={() => {
        onClose()
        markUnread(thread.id)
      }}
      onDeleteThread={() => {
        onClose()
        deleteWithUndo({ threadId: thread.id })
      }}
      onDeleteComment={(commentId) => {
        // Deleting the only comment deletes the thread with it.
        if (thread.comments.length === 1) onClose()
        deleteWithUndo({ threadId: thread.id, commentId })
      }}
    />
  )
}

/** The room's members for @mentions, fetched once the first card opens. */
export function useRoomMembers(
  roomId: string,
  enabled: boolean
): CommentMember[] {
  const [members, setMembers] = useState<CommentMember[] | null>(null)
  const requested = useRef(false)
  useEffect(() => {
    if (!enabled || requested.current) return
    requested.current = true
    listCollaborators(roomId)
      .then((rows) =>
        setMembers(
          rows.map((r) => ({
            userId: r.userId,
            name: r.name,
            avatar: r.avatar,
          }))
        )
      )
      .catch((e) => {
        // Mentions just won't suggest anyone; the card still works.
        console.error("listCollaborators failed:", e)
        requested.current = false
      })
  }, [roomId, enabled])
  return members ?? EMPTY_MEMBERS
}

const EMPTY_MEMBERS: CommentMember[] = []

function CommentPin({
  thread,
  number,
  pos,
  zoom,
  elementBox,
  isOpen,
  onOpenChange,
  children,
}: {
  thread: ThreadWithComments
  number: number | null
  pos: { x: number; y: number }
  zoom: number
  /** The element the thread points at, in canvas units, while it's open. */
  elementBox: { x: number; y: number; width: number; height: number } | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const firstComment = thread.comments[0]
  // The card opens beside the element when we know where it is, else beside
  // the pin. Both boxes are in canvas units relative to the pin's point.
  const pinSize = PIN_PX / zoom
  const pinBox = { left: 0, top: -pinSize, width: pinSize, height: pinSize }
  const box = elementBox
    ? {
        left: elementBox.x - pos.x,
        top: elementBox.y - pos.y,
        width: elementBox.width,
        height: elementBox.height,
      }
    : pinBox
  // The card anchors to the element and its pin together, so a pin on the
  // element's edge doesn't end up under the card.
  const anchor = unionBox(box, pinBox)
  return (
    <div
      // A hovered or open pin lifts over its neighbours, still under the
      // composer.
      className={isOpen ? "absolute z-1 size-0" : "absolute size-0 hover:z-1"}
      // The top bar's thread list finds a pin by this to bring it into view.
      data-comment-thread-id={thread.id}
      style={{ left: pos.x, top: pos.y }}
    >
      <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverAnchor asChild>
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={anchor}
          />
        </PopoverAnchor>
        {elementBox && (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              ...box,
              // A screen-constant 2px outline, 2px off the element.
              outline: `${2 / zoom}px solid var(--canvas-comment)`,
              outlineOffset: `${2 / zoom}px`,
              borderRadius: `${4 / zoom}px`,
            }}
          />
        )}
        <div
          style={{
            position: "relative",
            transform: `scale(${1 / zoom})`,
            transformOrigin: "bottom left",
          }}
        >
          <button
            type="button"
            // Not a PopoverTrigger: the card anchors to the element box
            // above, and a trigger would claim the anchor for itself.
            data-comment-pin
            aria-expanded={isOpen}
            onClick={(e) => {
              e.stopPropagation()
              onOpenChange(!isOpen)
            }}
            className="pointer-events-auto absolute bottom-0 left-0 rounded-[13px_13px_13px_3px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`Comment ${number ?? ""} by ${firstComment?.authorName ?? "user"}${thread.unread ? " (unread)" : ""}${thread.resolved ? " (resolved)" : ""}`}
          >
            <CommentPinMark
              number={number}
              unread={thread.unread}
              resolved={thread.resolved}
              className="transition-transform hover:scale-110"
            />
          </button>
        </div>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-[250px] p-3"
          onPointerDownOutside={(e) => {
            e.stopPropagation()
            // A press on this thread's own pin toggles it in its click.
            const target = e.detail.originalEvent.target as Element | null
            if (
              target?.closest(
                `[data-comment-thread-id="${CSS.escape(thread.id)}"] [data-comment-pin]`
              )
            ) {
              e.preventDefault()
            }
          }}
          onClick={(e) => e.stopPropagation()}
          // The card itself takes focus, so Tab goes on to its controls and
          // Escape closes it. Left alone, the popover would focus the first
          // control (Resolve), which pops its tooltip every time.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.focus({
              preventScroll: true,
            })
          }}
        >
          {children}
        </PopoverContent>
      </Popover>
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
  createThread,
  place,
  members,
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
}: {
  createThread: CommentThreads["createThread"]
  place: string | null
  members: CommentMember[]
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
}) {
  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const empty = !body.trim()
  return (
    <div className="flex flex-col gap-2.5">
      {place && (
        <div className="flex">
          <PlaceChip place={place} />
        </div>
      )}
      {quotedText && (
        <QuoteHeader
          quotedText={quotedText}
          lineFrom={lineFrom ?? null}
          lineTo={lineTo ?? null}
        />
      )}
      <MentionTextarea
        autoFocus
        rows={3}
        placeholder="Add a comment…"
        value={body}
        onChange={setBody}
        members={members}
        onSubmit={submit}
        onEscape={onCancel}
      />
      <ComposerFooter>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || empty}>
          Comment
        </Button>
      </ComposerFooter>
    </div>
  )

  async function submit() {
    const text = body.trim()
    if (!text || pending) return
    setPending(true)
    // A thread that wasn't saved keeps the composer open with its text.
    const saved = await createThread({
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
    setPending(false)
    if (saved) onSubmitted()
  }
}

/** A document thread's quoted range, with live line numbers. */
function ThreadQuote({
  thread,
  getDocumentEditor,
}: {
  thread: ThreadWithComments
  getDocumentEditor?: (id: string) => Editor | undefined
}) {
  // Recomputed against the current doc each time the card opens so they
  // reflect edits since the thread was created. No range if the doc isn't
  // mounted.
  const liveLines = useDocCommentLines(thread, getDocumentEditor)
  return (
    <QuoteHeader
      quotedText={thread.quotedText!}
      lineFrom={liveLines?.lineFrom ?? null}
      lineTo={liveLines?.lineTo ?? null}
    />
  )
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
    <div className="rounded-sm border-l-2 border-border bg-muted px-2 py-1.5 text-sm leading-snug text-muted-foreground">
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

type Box = { left: number; top: number; width: number; height: number }

function unionBox(a: Box, b: Box): Box {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  }
}
