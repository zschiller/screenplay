"use client"

import { useCallback, useEffect, useState } from "react"

import { useAppSession } from "@/lib/auth-client"
import type { ThreadWithComments } from "@/lib/comments"
import { listThreadsAction, markThreadReadAction } from "@/lib/comments-actions"
import { useCommentsReadRevision, useCommentsRevision } from "@/lib/yjs/react"

export interface CommentThreads {
  threads: ThreadWithComments[]
  /** False until the first fetch lands (or server-prefetched threads arrive),
   *  so "haven't fetched yet" isn't mistaken for "fetched and got zero". */
  threadsLoaded: boolean
  /** Mark a thread read: flips it locally at once, then persists. */
  markRead: (threadId: string) => void
  /** Flip a thread's local unread state without waiting for a refetch. */
  setThreadUnread: (threadId: string, unread: boolean) => void
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
  const [threads, setThreads] = useState<ThreadWithComments[]>(
    () => initialThreads ?? []
  )
  // Pre-fetched data from the server flips this immediately so pins render
  // on the very first paint.
  const [threadsLoaded, setThreadsLoaded] = useState(
    () => initialThreads !== undefined
  )
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
      })
      .catch((e) => console.error("listThreads failed:", e))
    return () => {
      cancelled = true
    }
  }, [roomId, revision, readRevision])

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

  return { threads, threadsLoaded, markRead, setThreadUnread }
}
