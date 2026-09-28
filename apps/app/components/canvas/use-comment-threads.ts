"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useAppSession } from "@/lib/auth-client"
import type { ThreadWithComments } from "@/lib/comments"
import {
  deleteCommentAction,
  deleteThreadAction,
  listThreadsAction,
  markThreadReadAction,
  setThreadResolvedAction,
} from "@/lib/comments-actions"
import { useCommentsReadRevision, useCommentsRevision } from "@/lib/yjs/react"

/** How long a deleted comment or thread can be brought back. */
const UNDO_MS = 5000

export interface CommentThreads {
  threads: ThreadWithComments[]
  /** False until the first fetch lands (or server-prefetched threads arrive),
   *  so "haven't fetched yet" isn't mistaken for "fetched and got zero". */
  threadsLoaded: boolean
  /** Mark a thread read: flips it locally at once, then persists. */
  markRead: (threadId: string) => void
  /** Flip a thread's local unread state without waiting for a refetch. */
  setThreadUnread: (threadId: string, unread: boolean) => void
  /** Resolve or reopen a thread at once, with a toast that undoes it. */
  setResolved: (threadId: string, resolved: boolean) => void
  /** Hide a comment or a whole thread at once and delete it once the undo
   *  toast's window passes. A failed delete puts it back and says so. */
  deleteWithUndo: (target: { threadId: string; commentId?: string }) => void
}

/**
 * The Canvas's comment threads, shared by the pins on the canvas and the
 * top bar's comment count and thread list so both read one list.
 *
 * Refetches on every comments revision bump (the server-side notification
 * channel) and on the acting user's own read-state bump.
 */
export function useCommentThreads(
  roomId: string,
  initialThreads: ThreadWithComments[] | undefined
): CommentThreads {
  const { data: session } = useAppSession()
  const [fetched, setThreads] = useState<ThreadWithComments[]>(
    () => initialThreads ?? []
  )
  // Pre-fetched data from the server flips this immediately so pins render
  // on the very first paint.
  const [threadsLoaded, setThreadsLoaded] = useState(
    () => initialThreads !== undefined
  )
  // Local overrides that hold until the server agrees: resolved state set
  // optimistically, and comments/threads waiting out their undo window.
  const [resolvedOverride, setResolvedOverride] = useState<
    ReadonlyMap<string, boolean>
  >(new Map())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const revision = useCommentsRevision()
  // Bumped only when *this* user marks a thread read/unread (possibly from
  // another tab), so we refetch to recompute unread without every client in
  // the room refetching.
  const readRevision = useCommentsReadRevision(session?.user.id ?? null)

  useEffect(() => {
    let cancelled = false
    listThreadsAction(roomId)
      .then((rows) => {
        if (cancelled) return
        setThreads(rows)
        setThreadsLoaded(true)
        // The fetched rows now carry every resolve that has landed.
        setResolvedOverride((prev) => {
          if (prev.size === 0) return prev
          const next = new Map(prev)
          for (const t of rows) {
            if (next.get(t.id) === t.resolved) next.delete(t.id)
          }
          return next
        })
      })
      .catch((e) => console.error("listThreads failed:", e))
    return () => {
      cancelled = true
    }
  }, [roomId, revision, readRevision])

  const threads = useMemo(() => {
    if (hidden.size === 0 && resolvedOverride.size === 0) return fetched
    const out: ThreadWithComments[] = []
    for (const t of fetched) {
      if (hidden.has(t.id)) continue
      const comments = t.comments.filter((c) => !hidden.has(c.id))
      if (comments.length === 0) continue
      const resolved = resolvedOverride.get(t.id) ?? t.resolved
      out.push(
        comments.length === t.comments.length && resolved === t.resolved
          ? t
          : { ...t, comments, resolved }
      )
    }
    return out
  }, [fetched, hidden, resolvedOverride])

  // Optimistic, so an opened pin doesn't flicker back to unread while the
  // refetch is in flight.
  const setThreadUnread = useCallback((threadId: string, unread: boolean) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread } : t))
    )
  }, [])

  const markRead = useCallback(
    (threadId: string) => {
      setThreadUnread(threadId, false)
      markThreadReadAction(threadId).catch((e) =>
        console.error("markThreadRead failed:", e)
      )
    },
    [setThreadUnread]
  )

  const setResolved = useCallback(function setResolved(
    threadId: string,
    resolved: boolean
  ) {
    const override = (value: boolean | null) =>
      setResolvedOverride((prev) => {
        const next = new Map(prev)
        if (value === null) next.delete(threadId)
        else next.set(threadId, value)
        return next
      })
    override(resolved)
    setThreadResolvedAction({ threadId, resolved }).then(
      () => {
        if (!resolved) return
        toast("Thread resolved", {
          action: {
            label: "Undo",
            onClick: () => setResolved(threadId, false),
          },
        })
      },
      (e) => {
        console.error("setThreadResolved failed:", e)
        override(null)
        toast.error(
          resolved
            ? "Couldn't resolve the thread"
            : "Couldn't reopen the thread"
        )
      }
    )
  }, [])

  // Deletes still inside their undo window, flushed at once if the canvas
  // unmounts so leaving the room doesn't quietly cancel them.
  const pending = useRef(new Map<string, () => void>())
  useEffect(() => {
    const flushes = pending.current
    return () => {
      for (const flush of flushes.values()) flush()
      flushes.clear()
    }
  }, [])

  const deleteWithUndo = useCallback(
    ({ threadId, commentId }: { threadId: string; commentId?: string }) => {
      const id = commentId ?? threadId
      const unhide = () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      setHidden((prev) => new Set(prev).add(id))
      const commit = () => {
        clearTimeout(timer)
        pending.current.delete(id)
        const run = commentId
          ? deleteCommentAction({ commentId })
          : deleteThreadAction(threadId)
        run.catch((e) => {
          console.error("delete failed:", e)
          unhide()
          toast.error(
            commentId
              ? "Couldn't delete the comment"
              : "Couldn't delete the thread"
          )
        })
      }
      const timer = setTimeout(commit, UNDO_MS)
      pending.current.set(id, commit)
      toast(commentId ? "Comment deleted" : "Thread deleted", {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            clearTimeout(timer)
            pending.current.delete(id)
            unhide()
          },
        },
      })
    },
    []
  )

  return {
    threads,
    threadsLoaded,
    markRead,
    setThreadUnread,
    setResolved,
    deleteWithUndo,
  }
}
