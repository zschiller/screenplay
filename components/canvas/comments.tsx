"use client"

import { useState } from "react"
import { useThreads } from "@liveblocks/react/suspense"
import {
  FloatingThread,
  FloatingComposer,
  CommentPin,
} from "@liveblocks/react-ui"

interface ArtboardPos {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface CommentsProps {
  zoom: number
  commentMode: boolean
  newCommentPos: { x: number; y: number; artboardId?: string } | null
  onNewCommentPlaced: () => void
  onCancelComment: () => void
  artboards: ArtboardPos[]
}

export function Comments({
  zoom,
  commentMode,
  newCommentPos,
  onNewCommentPlaced,
  onCancelComment,
  artboards,
}: CommentsProps) {
  const { threads } = useThreads()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  // Counter-scale so pins stay readable at any zoom level
  const pinScale = 1 / zoom
  const pinStyle = {
    transform: `scale(${pinScale})`,
    transformOrigin: "bottom left" as const,
  }

  function getThreadPosition(metadata: { x: number; y: number; artboardId?: string }) {
    if (metadata.artboardId) {
      const ab = artboards.find((a) => a.id === metadata.artboardId)
      if (ab) {
        return { x: ab.x + metadata.x, y: ab.y + metadata.y }
      }
    }
    return { x: metadata.x, y: metadata.y }
  }

  function getNewCommentCanvasPos() {
    if (!newCommentPos) return null
    if (newCommentPos.artboardId) {
      const ab = artboards.find((a) => a.id === newCommentPos.artboardId)
      if (ab) {
        return { x: ab.x + newCommentPos.x, y: ab.y + newCommentPos.y }
      }
    }
    return { x: newCommentPos.x, y: newCommentPos.y }
  }

  const composerCanvasPos = getNewCommentCanvasPos()

  return (
    <>
      {/* Existing thread pins */}
      {threads
        .filter((t) => !t.resolved)
        .map((thread) => {
          const pos = getThreadPosition(thread.metadata)
          return (
            <div
              key={thread.id}
              className="absolute z-[100]"
              style={{ left: pos.x, top: pos.y }}
            >
              <div style={pinStyle}>
                <FloatingThread
                  thread={thread}
                  open={activeThreadId === thread.id}
                  onOpenChange={(open) =>
                    setActiveThreadId(open ? thread.id : null)
                  }
                >
                  <CommentPin
                    userId={thread.comments[0]?.userId}
                    onClick={(e) => e.stopPropagation()}
                  />
                </FloatingThread>
              </div>
            </div>
          )
        })}

      {/* New comment composer */}
      {newCommentPos && composerCanvasPos && (
        <div
          className="absolute z-[100]"
          style={{
            left: composerCanvasPos.x,
            top: composerCanvasPos.y,
          }}
        >
          <div style={pinStyle}>
            <FloatingComposer
              metadata={{
                x: newCommentPos.x,
                y: newCommentPos.y,
                artboardId: newCommentPos.artboardId,
              }}
              defaultOpen
              onOpenChange={(open) => {
                if (!open) onCancelComment()
              }}
              onComposerSubmit={() => onNewCommentPlaced()}
            >
              <CommentPin onClick={(e) => e.stopPropagation()} />
            </FloatingComposer>
          </div>
        </div>
      )}
    </>
  )
}
