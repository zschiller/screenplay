"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useAppSession } from "@/lib/auth-client"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"
import {
  appendCommentAction,
  createThreadAction,
  deleteCommentAction,
  deleteThreadAction,
  editCommentAction,
  listThreadsAction,
  markThreadReadAction,
  markThreadUnreadAction,
  setThreadResolvedAction,
} from "@/lib/comments-actions"
import { useCommentsReadRevision, useCommentsRevision } from "@/lib/yjs/react"

/** How long a deleted comment or thread can be brought back. */
const UNDO_MS = 5000

/** Counts replies shown before they're saved, for their placeholder ids. */
let pendingReplies = 0

/** What a failed write says. Every write fails the same way: its optimistic
 *  change rolls back and this shows in a toast. */
const FAILED = {
  create: "Couldn't post the comment",
  reply: "Couldn't send the reply",
  edit: "Couldn't save the comment",
  read: "Couldn't mark the thread read",
  unread: "Couldn't mark the thread unread",
  resolve: "Couldn't resolve the thread",
  reopen: "Couldn't reopen the thread",
  deleteComment: "Couldn't delete the comment",
  deleteThread: "Couldn't delete the thread",
} as const

/** A new thread: where it points and its first comment. The Room is the
 *  store's. */
export type NewThread = Omit<Parameters<typeof createThreadAction>[0], "roomId">

export interface CommentThreads {
  threads: ThreadWithComments[]
  /** False until the first fetch lands (or server-prefetched threads arrive),
   *  so "haven't fetched yet" isn't mistaken for "fetched and got zero". */
  threadsLoaded: boolean
  /** Start a thread. Resolves to it once saved, or null when it wasn't (the
   *  store has said so), so the composer can keep what was typed. */
  createThread: (thread: NewThread) => Promise<ThreadWithComments | null>
  /** Reply to a thread: the reply shows at once. Resolves false when it
   *  wasn't saved, once it's been taken back out. */
  reply: (threadId: string, body: string) => Promise<boolean>
  /** Change a comment's text: the new text shows at once. Resolves false
   *  when it wasn't saved, once the old text is back. */
  editComment: (commentId: string, body: string) => Promise<boolean>
  /** Mark a thread read or unread: flips it at once, then persists. */
  markRead: (threadId: string) => void
  markUnread: (threadId: string) => void
  /** Resolve or reopen a thread at once, with a toast that undoes it. */
  setResolved: (threadId: string, resolved: boolean) => void
  /** Hide a comment or a whole thread at once and delete it once the undo
   *  toast's window passes. A failed delete puts it back and says so. */
  deleteWithUndo: (target: { threadId: string; commentId?: string }) => void
}

/**
 * The Canvas's comment threads, shared by the pins on the canvas, the top
 * bar's comment count and thread list, and the player (#789), so all read one
 * list. Every comment write goes through here, so optimistic updates, undo
 * and what a failure says are decided in one place.
 *
 * Refetches on every comments revision bump (the server-side notification
 * channel) and on the acting user's own read-state bump.
 */
export function useCommentThreads(
  roomId: string,
  initialThreads: ThreadWithComments[] | undefined
): CommentThreads {
  const { data: session } = useAppSession()
  const user = session?.user
  const [fetched, setThreads] = useState<ThreadWithComments[]>(
    () => initialThreads ?? []
  )
  // Pre-fetched data from the server flips this immediately so pins render
  // on the very first paint.
  const [threadsLoaded, setThreadsLoaded] = useState(
    () => initialThreads !== undefined
  )
  // Local overrides that hold until a fetch agrees with them: writes shown
  // optimistically, and comments/threads waiting out their undo window.
  const [resolvedOverride, setResolvedOverride] = useOverrides<boolean>()
  const [unreadOverride, setUnreadOverride] = useOverrides<boolean>()
  const [bodyOverride, setBodyOverride] = useOverrides<{
    body: string
    editedAt: number
  }>()
  // Replies by a placeholder id, holding the saved comment once it's back.
  const [replies, setReply] = useOverrides<CommentRecord>()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const revision = useCommentsRevision()
  // Bumped only when *this* user marks a thread read/unread (possibly from
  // another tab), so we refetch to recompute unread without every client in
  // the room refetching.
  const readRevision = useCommentsReadRevision(user?.id ?? null)

  useEffect(() => {
    let cancelled = false
    listThreadsAction(roomId)
      .then((rows) => {
        if (cancelled) return
        setThreads(rows)
        setThreadsLoaded(true)
        // Drop every override the fetched rows now carry.
        const byId = new Map(rows.map((t) => [t.id, t]))
        const comments = new Map(
          rows.flatMap((t) => t.comments.map((c) => [c.id, c]))
        )
        setResolvedOverride.settle(
          (id, resolved) => byId.get(id)?.resolved === resolved
        )
        setUnreadOverride.settle(
          (id, unread) => byId.get(id)?.unread === unread
        )
        setBodyOverride.settle(
          (id, { body }) => comments.get(id)?.body === body
        )
        setReply.settle((_, reply) => comments.has(reply.id))
      })
      .catch((e) => console.error("listThreads failed:", e))
    return () => {
      cancelled = true
    }
  }, [
    roomId,
    revision,
    readRevision,
    setResolvedOverride,
    setUnreadOverride,
    setBodyOverride,
    setReply,
  ])

  const threads = useMemo(() => {
    if (
      hidden.size === 0 &&
      resolvedOverride.size === 0 &&
      unreadOverride.size === 0 &&
      bodyOverride.size === 0 &&
      replies.size === 0
    ) {
      return fetched
    }
    const pendingReplies = new Map<string, CommentRecord[]>()
    for (const r of replies.values()) {
      pendingReplies.set(r.threadId, [
        ...(pendingReplies.get(r.threadId) ?? []),
        r,
      ])
    }
    const out: ThreadWithComments[] = []
    for (const t of fetched) {
      if (hidden.has(t.id)) continue
      const saved = new Set(t.comments.map((c) => c.id))
      const comments = [
        ...t.comments,
        ...(pendingReplies.get(t.id) ?? []).filter((r) => !saved.has(r.id)),
      ].flatMap((c) => {
        if (hidden.has(c.id)) return []
        const edit = bodyOverride.get(c.id)
        return [edit ? { ...c, ...edit } : c]
      })
      if (comments.length === 0) continue
      const resolved = resolvedOverride.get(t.id) ?? t.resolved
      const unread = unreadOverride.get(t.id) ?? t.unread
      const same =
        comments.length === t.comments.length &&
        comments.every((c, i) => c === t.comments[i])
      out.push(
        same && resolved === t.resolved && unread === t.unread
          ? t
          : { ...t, comments, resolved, unread }
      )
    }
    return out
  }, [fetched, hidden, resolvedOverride, unreadOverride, bodyOverride, replies])

  const createThread = useCallback(
    async (thread: NewThread) => {
      try {
        const saved = await createThreadAction({ ...thread, roomId })
        // Shown now rather than on the refetch its save rings for.
        setThreads((prev) =>
          prev.some((t) => t.id === saved.id) ? prev : [...prev, saved]
        )
        return saved
      } catch (e) {
        fail("createThread", e, FAILED.create)
        return null
      }
    },
    [roomId]
  )

  const reply = useCallback(
    async (threadId: string, body: string) => {
      const key = `pending-${++pendingReplies}`
      setReply(key, {
        id: key,
        threadId,
        authorId: user?.id ?? "",
        authorName: user?.name ?? "You",
        authorAvatar: user?.image ?? null,
        body,
        fromAgent: false,
        createdAt: Date.now(),
        editedAt: null,
      })
      try {
        // Held under its placeholder until a fetch carries it.
        setReply(key, await appendCommentAction({ threadId, body }))
        return true
      } catch (e) {
        setReply(key, null)
        fail("appendComment", e, FAILED.reply)
        return false
      }
    },
    [user?.id, user?.name, user?.image, setReply]
  )

  const editComment = useCallback(
    async (commentId: string, body: string) => {
      const undo = setBodyOverride(commentId, { body, editedAt: Date.now() })
      try {
        await editCommentAction({ commentId, body })
        return true
      } catch (e) {
        undo()
        fail("editComment", e, FAILED.edit)
        return false
      }
    },
    [setBodyOverride]
  )

  const setUnread = useCallback(
    (threadId: string, unread: boolean) => {
      const undo = setUnreadOverride(threadId, unread)
      const save = unread ? markThreadUnreadAction : markThreadReadAction
      save(threadId).catch((e) => {
        undo()
        fail(
          unread ? "markThreadUnread" : "markThreadRead",
          e,
          unread ? FAILED.unread : FAILED.read
        )
      })
    },
    [setUnreadOverride]
  )
  const markRead = useCallback(
    (threadId: string) => setUnread(threadId, false),
    [setUnread]
  )
  const markUnread = useCallback(
    (threadId: string) => setUnread(threadId, true),
    [setUnread]
  )

  const setResolved = useCallback(
    function setResolved(threadId: string, resolved: boolean) {
      const undo = setResolvedOverride(threadId, resolved)
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
          undo()
          fail(
            "setThreadResolved",
            e,
            resolved ? FAILED.resolve : FAILED.reopen
          )
        }
      )
    },
    [setResolvedOverride]
  )

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
          unhide()
          fail(
            "delete",
            e,
            commentId ? FAILED.deleteComment : FAILED.deleteThread
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
    createThread,
    reply,
    editComment,
    markRead,
    markUnread,
    setResolved,
    deleteWithUndo,
  }
}

function fail(op: string, error: unknown, message: string): void {
  console.error(`${op} failed:`, error)
  toast.error(message)
}

/** A map of local overrides by id. `set(id, value)` holds one (null drops
 *  it) and returns what undoes it: the override before comes back, unless a
 *  later write has replaced this one. `set.settle(agrees)` drops each one a
 *  fetch now agrees with. */
function useOverrides<V>(): [
  ReadonlyMap<string, V>,
  ((id: string, value: V | null) => () => void) & {
    settle: (agrees: (id: string, value: V) => boolean) => void
  },
] {
  const [map, setMap] = useState<ReadonlyMap<string, V>>(new Map())
  const set = useMemo(() => {
    const put = (next: Map<string, V>, id: string, value: V | undefined) => {
      if (value === undefined) next.delete(id)
      else next.set(id, value)
      return next
    }
    const set = (id: string, value: V | null) => {
      const held = value ?? undefined
      let before: V | undefined
      setMap((prev) => {
        before = prev.get(id)
        return put(new Map(prev), id, held)
      })
      return () =>
        setMap((prev) =>
          prev.get(id) === held ? put(new Map(prev), id, before) : prev
        )
    }
    const settle = (agrees: (id: string, value: V) => boolean) =>
      setMap((prev) => {
        if (prev.size === 0) return prev
        const next = new Map(prev)
        for (const [id, value] of prev) {
          if (agrees(id, value)) next.delete(id)
        }
        return next.size === prev.size ? prev : next
      })
    return Object.assign(set, { settle })
  }, [])
  return [map, set]
}
