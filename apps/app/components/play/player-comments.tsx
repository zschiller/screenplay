"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react"

import { Comments, type FrameInfo } from "@/components/canvas/comments"
import { threadNumbers } from "@/components/canvas/comment-thread-card"
import { useCommentPlacements } from "@/components/canvas/use-comment-placements"
import {
  useCommentThreads,
  type CommentThreads,
} from "@/components/canvas/use-comment-threads"
import { useScreenplayDom } from "@/hooks/use-screenplay-dom"
import type { ElementAnchor, Placement } from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"
import { isLocalBuild } from "@/lib/local-mode"
import type { DomRect } from "@/lib/postmessage-protocol"
import { useIframeLayers } from "@/lib/yjs/react"

/** The player's one frame, keyed like a canvas frame so the canvas's comment
 *  pieces place and draw its pins unchanged. */
const PLAYER_FRAME = "player"

interface NewPlayerComment {
  x: number
  y: number
  iframeLayerId: string
  selector?: string | null
  offsetX?: number | null
  offsetY?: number | null
  anchor?: ElementAnchor | null
  route?: string | null
}

export interface PlayerComments {
  /** The Workspace's threads, with the canvas's thread actions. */
  commentThreads: CommentThreads
  /** Each thread's canvas pin number. */
  numbers: ReadonlyMap<string, number>
  placements: ReadonlyMap<string, Placement>
  /** Open a thread from the list, going to its route first if need be. */
  selectThread: (threadId: string) => void
  commentMode: boolean
  toggleCommentMode: () => void
  layer: PlayerCommentLayerProps
}

/**
 * The player's comments (#789): the same threads, pins and cards as the
 * Workspace's frames on the canvas, placed on the live page. Press C, click an
 * element, and the comment is anchored to it exactly as a frame comment is
 * (#785): Workspace, route, element, viewport.
 *
 * The player is one frame showing one Workspace, so its threads are the
 * Canvas's threads made on that Workspace: in the player, or on any frame that
 * shows it.
 */
export function usePlayerComments({
  roomId,
  agentId,
  iframeLayerId,
  initialThreads,
  iframeRef,
  viewport,
  scale,
  route,
  describeWorkspace,
  onNavigate,
}: {
  roomId: string
  /** The Workspace the player shows. */
  agentId: string
  /** The canvas frame the player was opened from, if any. */
  iframeLayerId?: string
  initialThreads: ThreadWithComments[]
  iframeRef: RefObject<HTMLIFrameElement | null>
  /** The page's viewport, in its own pixels. */
  viewport: { width: number; height: number } | null
  /** How far the device preview is scaled down to fit. */
  scale: number
  /** The route the player opened on, for a page that can't report its own. */
  route: string
  describeWorkspace: () => { title?: string; route?: string }
  onNavigate: (route: string) => void
}): PlayerComments {
  const all = useCommentThreads(roomId, initialThreads)
  const iframeLayers = useIframeLayers()

  // Threads that predate Workspace anchors know only their frame: they're
  // this Workspace's when that frame shows it. Each is given the Workspace so
  // placement finds the player's frame for it.
  const threads = useMemo(() => {
    const shows = new Set(
      iframeLayers.filter((l) => l.branchId === agentId).map((l) => l.id)
    )
    return all.threads.flatMap((t) => {
      if (t.workspaceId === agentId) return [t]
      if (!t.workspaceId && t.iframeLayerId && shows.has(t.iframeLayerId)) {
        return [{ ...t, workspaceId: agentId }]
      }
      return []
    })
  }, [all.threads, iframeLayers, agentId])
  const commentThreads = useMemo(() => ({ ...all, threads }), [all, threads])
  const numbers = useMemo(() => threadNumbers(all.threads), [all.threads])

  const [commentMode, setCommentMode] = useState(false)
  const [newComment, setNewComment] = useState<NewPlayerComment | null>(null)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [hover, setHover] = useState<DomRect | null>(null)
  const exitCommentMode = useCallback(() => {
    setCommentMode(false)
    setNewComment(null)
    setHover(null)
  }, [])
  const toggleCommentMode = useCallback(() => {
    if (commentMode) exitCommentMode()
    else setCommentMode(true)
  }, [commentMode, exitCommentMode])

  // Esc pressed inside the page comes back through the bridge.
  const dom = useScreenplayDom(iframeRef, {
    onEscape: () => {
      if (newComment) setNewComment(null)
      else if (commentMode) exitCommentMode()
    },
  })
  const getDom = useCallback(() => dom, [dom])

  const frames = useMemo(
    () => [{ id: PLAYER_FRAME, branchId: agentId, route }],
    [agentId, route]
  )
  const layouts = useMemo(
    () => new Map(viewport ? [[PLAYER_FRAME, viewport]] : []),
    [viewport]
  )
  const { placements } = useCommentPlacements({
    threads,
    iframeLayers: frames,
    layouts,
    zoom: 1,
    getIframeLayerDom: getDom,
    activeThreadId,
  })

  const selectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId)
      all.markRead(threadId)
      const placement = placements.get(threadId)
      if (placement?.kind === "offRoute") onNavigate(placement.route)
    },
    [all, placements, onNavigate]
  )

  // C comments and Esc stops, as on the canvas. Keys typed inside the page
  // stay with the page.
  useEffect(() => {
    if (isLocalBuild) return
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        toggleCommentMode()
      } else if (e.key === "Escape" && commentMode && !e.defaultPrevented) {
        if (newComment) setNewComment(null)
        else exitCommentMode()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [commentMode, newComment, toggleCommentMode, exitCommentMode])

  // A click shows the composer at once; the element under it is resolved in
  // the background and patched in, as on the canvas.
  const place = useCallback(
    (x: number, y: number) => {
      setNewComment({ x, y, iframeLayerId: PLAYER_FRAME })
      dom
        .elementAtPoint(x, y)
        .then((result) => {
          if (!result) return
          const { width: w, height: h } = result.rect
          setNewComment((prev) =>
            prev && prev.x === x && prev.y === y
              ? {
                  ...prev,
                  selector: result.selector || null,
                  offsetX: w > 0 ? (x - result.rect.x) / w : 0,
                  offsetY: h > 0 ? (y - result.rect.y) / h : 0,
                  anchor: result.anchor ?? null,
                  route: result.path ?? null,
                }
              : prev
          )
        })
        .catch(() => {})
    },
    [dom]
  )
  const hoverAt = useCallback(
    (x: number, y: number) => {
      dom
        .elementAtPoint(x, y)
        .then((result) => setHover(result ? result.rect : null))
        .catch(() => setHover(null))
    },
    [dom]
  )

  const frameInfo = useMemo(
    () =>
      new Map<string, FrameInfo>([
        [
          PLAYER_FRAME,
          { branchId: agentId, route, storedLayerId: iframeLayerId ?? null },
        ],
      ]),
    [agentId, route, iframeLayerId]
  )

  return {
    commentThreads,
    numbers,
    placements,
    selectThread,
    commentMode,
    toggleCommentMode,
    layer: {
      roomId,
      viewport,
      scale,
      commentThreads,
      numbers,
      placements,
      frameInfo,
      describeWorkspace,
      commentMode,
      hover,
      newComment,
      activeThreadId,
      onActivateThread: setActiveThreadId,
      onPlace: place,
      onHover: hoverAt,
      onHoverEnd: () => setHover(null),
      onPlaced: exitCommentMode,
      onCancel: () => setNewComment(null),
    },
  }
}

interface PlayerCommentLayerProps {
  roomId: string
  viewport: { width: number; height: number } | null
  scale: number
  commentThreads: CommentThreads
  numbers: ReadonlyMap<string, number>
  placements: ReadonlyMap<string, Placement>
  frameInfo: ReadonlyMap<string, FrameInfo>
  describeWorkspace: () => { title?: string; route?: string }
  commentMode: boolean
  hover: DomRect | null
  newComment: NewPlayerComment | null
  activeThreadId: string | null
  onActivateThread: (threadId: string | null) => void
  onPlace: (x: number, y: number) => void
  onHover: (x: number, y: number) => void
  onHoverEnd: () => void
  onPlaced: () => void
  onCancel: () => void
}

/**
 * The pins, cards and composer over the player's page, and in comment mode the
 * click target that outlines the element under the pointer. Sits in the device
 * preview, so it scales with it; pins and cards stay screen-size.
 */
export function PlayerCommentLayer({
  roomId,
  viewport,
  scale,
  commentThreads,
  numbers,
  placements,
  frameInfo,
  describeWorkspace,
  commentMode,
  hover,
  newComment,
  activeThreadId,
  onActivateThread,
  onPlace,
  onHover,
  onHoverEnd,
  onPlaced,
  onCancel,
}: PlayerCommentLayerProps) {
  if (!viewport) return null
  // Pointer to page pixels: the preview is scaled about its centre.
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - box.left) / scale,
      y: (e.clientY - box.top) / scale,
    }
  }
  return (
    <>
      {commentMode && (
        <div
          className="absolute inset-0"
          onPointerMove={(e) => {
            const p = local(e)
            onHover(p.x, p.y)
          }}
          onPointerLeave={onHoverEnd}
          onClick={(e) => {
            const p = local(e)
            onPlace(p.x, p.y)
          }}
        >
          {hover && !newComment && (
            <div
              aria-hidden
              className="pointer-events-none absolute border border-canvas-inspect bg-canvas-inspect/10"
              style={{
                left: hover.x,
                top: hover.y,
                width: hover.width,
                height: hover.height,
                borderWidth: 1 / scale,
              }}
            />
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0">
        <Comments
          roomId={roomId}
          zoom={scale}
          newCommentPos={newComment}
          onNewCommentPlaced={onPlaced}
          onCancelComment={onCancel}
          iframeLayers={[{ id: PLAYER_FRAME, x: 0, y: 0, ...viewport }]}
          frameInfo={frameInfo}
          placements={placements}
          commentThreads={commentThreads}
          numbers={numbers}
          activeThreadId={activeThreadId}
          onActivateThread={onActivateThread}
          describeLayer={describeWorkspace}
        />
      </div>
    </>
  )
}
