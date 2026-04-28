"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { useSession } from "@/lib/auth-client"
import {
  createBranchCommentAction,
  deleteBranchCommentAction,
  listBranchCommentsAction,
} from "@/lib/branch-comments-actions"
import type { BranchCommentRecord } from "@/lib/branch-comments"

interface PlayerCommentsProps {
  roomId: string
  branch: string
  agentId: string
  initialComments: BranchCommentRecord[]
}

export function PlayerComments({
  roomId,
  branch,
  initialComments,
}: PlayerCommentsProps) {
  const { data: session } = useSession()
  const [comments, setComments] = useState<BranchCommentRecord[]>(initialComments)
  const [body, setBody] = useState("")
  const [isPending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pull a fresh list whenever the panel opens — picks up comments anyone
  // else added since the page rendered.
  useEffect(() => {
    let cancelled = false
    listBranchCommentsAction({ roomId, branch })
      .then((next) => {
        if (!cancelled) setComments(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [roomId, branch])

  // Keep the list pinned to the latest comment.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [comments.length])

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim()
    if (!trimmed || isPending || !branch) return
    startTransition(async () => {
      try {
        const created = await createBranchCommentAction({
          roomId,
          branch,
          body: trimmed,
        })
        setComments((prev) => [...prev, created])
        setBody("")
      } catch {
        // Leave the body in the input so the user can retry.
      }
    })
  }, [body, isPending, branch, roomId])

  const handleDelete = useCallback(
    (commentId: string) => {
      startTransition(async () => {
        try {
          await deleteBranchCommentAction({ commentId })
          setComments((prev) => prev.filter((c) => c.id !== commentId))
        } catch {}
      })
    },
    [],
  )

  const meId = session?.user?.id

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-medium text-foreground">Branch comments</span>
        <span className="font-mono text-[10px] text-muted-foreground">{branch || "(no branch)"}</span>
      </div>
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No comments yet. Drop a note for this branch — anyone with access to the project will see it.
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-2">
              <Avatar className="size-6 shrink-0">
                <AvatarImage src={c.authorAvatar ?? undefined} alt={c.authorName} />
                <AvatarFallback className="text-[10px]">
                  {(c.authorName[0] ?? "?").toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">
                    {c.authorName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatAgo(c.createdAt)}
                  </span>
                  {c.authorId === meId ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      title="Delete comment"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-foreground whitespace-pre-wrap break-words">
                  {c.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <form
        className="flex flex-col gap-1.5 border-t border-border/60 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={branch ? `Comment on ${branch}…` : "Branch isn't ready yet"}
          disabled={!branch}
          rows={2}
          className="resize-none text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
              ⌘ Enter
            </kbd>{" "}
            to send
          </span>
          <Button
            type="submit"
            size="xs"
            disabled={!body.trim() || isPending || !branch}
          >
            {isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  )
}

function formatAgo(ms: number): string {
  const diff = Date.now() - ms
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  return new Date(ms).toLocaleDateString()
}
