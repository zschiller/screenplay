"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { Check, MessageSquare, Trash2 } from "lucide-react"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Button } from "@workspace/ui/components/button"
import { useSession } from "@/lib/auth-client"
import { useCommentsRevision } from "@/lib/yjs/react"
import {
  appendCommentAction,
  createThreadAction,
  deleteCommentAction,
  deleteThreadAction,
  listThreadsAction,
  setThreadResolvedAction,
} from "@/lib/comments-actions"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"

interface ArtboardPos {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface CommentsProps {
  roomId: string
  zoom: number
  newCommentPos: { x: number; y: number; artboardId?: string } | null
  onNewCommentPlaced: () => void
  onCancelComment: () => void
  artboards: ArtboardPos[]
}

export function Comments({
  roomId,
  zoom,
  newCommentPos,
  onNewCommentPlaced,
  onCancelComment,
  artboards,
}: CommentsProps) {
  const { data: session } = useSession()
  const [threads, setThreads] = useState<ThreadWithComments[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const revision = useCommentsRevision()

  // Load + refetch on every revision bump (server-side notification channel).
  useEffect(() => {
    let cancelled = false
    listThreadsAction(roomId)
      .then((rows) => {
        if (!cancelled) setThreads(rows)
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

  const resolvePos = useCallback(
    (t: { x: number; y: number; artboardId?: string | null }) => {
      if (t.artboardId) {
        const ab = artboardById.get(t.artboardId)
        if (ab) return { x: ab.x + t.x, y: ab.y + t.y }
      }
      return { x: t.x, y: t.y }
    },
    [artboardById],
  )

  const composerCanvasPos = newCommentPos ? resolvePos(newCommentPos) : null

  return (
    <>
      {threads
        .filter((t) => !t.resolved)
        .map((thread) => {
          const pos = resolvePos(thread)
          return (
            <div
              key={thread.id}
              className="absolute z-[100]"
              style={{ left: pos.x, top: pos.y }}
            >
              <div style={pinStyle}>
                <Popover
                  open={activeThreadId === thread.id}
                  onOpenChange={(open) =>
                    setActiveThreadId(open ? thread.id : null)
                  }
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="flex h-7 w-7 -translate-y-full items-center justify-center rounded-tl-md rounded-tr-md rounded-br-md bg-amber-400 text-white shadow-md ring-1 ring-amber-500/30 hover:bg-amber-500"
                      aria-label={`Open thread by ${thread.comments[0]?.authorName ?? "user"}`}
                    >
                      <MessageSquare className="size-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    className="w-80 p-0"
                    onPointerDownOutside={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ThreadView
                      thread={thread}
                      currentUserId={session?.user.id ?? null}
                      onClose={() => setActiveThreadId(null)}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )
        })}

      {newCommentPos && composerCanvasPos && (
        <div
          className="absolute z-[100]"
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
                <div className="size-0" />
              </PopoverAnchor>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={0}
                className="w-72"
                onPointerDownOutside={(e) => e.preventDefault()}
              >
                <NewThreadComposer
                  roomId={roomId}
                  x={newCommentPos.x}
                  y={newCommentPos.y}
                  artboardId={newCommentPos.artboardId}
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
  onSubmitted,
  onCancel,
}: {
  roomId: string
  x: number
  y: number
  artboardId?: string
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
        await createThreadAction({ roomId, x, y, artboardId, body: text })
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
}: {
  thread: ThreadWithComments
  currentUserId: string | null
  onClose: () => void
}) {
  const [reply, setReply] = useState("")
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col">
      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {thread.comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            currentUserId={currentUserId}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
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
          disabled={pending}
        >
          <Check className="mr-1 size-3.5" />
          Resolve
        </Button>
        {currentUserId === thread.createdBy && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              start(async () => {
                try {
                  await deleteThreadAction(thread.id)
                  onClose()
                } catch (e) {
                  console.error("deleteThread failed:", e)
                }
              })
            }
            disabled={pending}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
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
