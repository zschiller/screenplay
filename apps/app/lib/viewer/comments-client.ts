"use client"

import { withBasePath } from "@/lib/base-path"
import type { CommentRecord, ThreadWithComments } from "@/lib/comments"
import type { NewThreadInput } from "@/lib/comment-input"
import type { ViewerCommentOp } from "@/lib/viewer/comment-ops"
import type { Viewing } from "@/lib/viewer/context"

/**
 * A viewer page's comment calls (Sharing, #1934): the same calls the canvas
 * makes through the comment server actions, sent to the canvas link's
 * comments route instead, since the viewer listener refuses server actions.
 */
export function viewerCommentsClient(viewing: Viewing) {
  const path = withBasePath(
    `/s/${encodeURIComponent(viewing.roomId)}/${viewing.shareKey}/comments`
  )
  async function post<T>(op: ViewerCommentOp): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op),
    })
    if (!res.ok) throw new Error(`${op.op} failed: ${res.status}`)
    return (await res.json()) as T
  }
  return {
    async listThreads(): Promise<ThreadWithComments[]> {
      const res = await fetch(path, { cache: "no-store" })
      if (!res.ok) throw new Error(`listThreads failed: ${res.status}`)
      return (await res.json()) as ThreadWithComments[]
    },
    createThread: (thread: NewThreadInput) =>
      post<ThreadWithComments>({ op: "create", thread }),
    appendComment: (opts: { threadId: string; body: string }) =>
      post<CommentRecord>({ op: "reply", ...opts }),
    editComment: (opts: { commentId: string; body: string }) =>
      post<unknown>({ op: "edit", ...opts }).then(() => {}),
    deleteComment: (opts: { commentId: string }) =>
      post<unknown>({ op: "deleteComment", ...opts }).then(() => {}),
    deleteThread: (threadId: string) =>
      post<unknown>({ op: "deleteThread", threadId }).then(() => {}),
    setThreadResolved: (opts: { threadId: string; resolved: boolean }) =>
      post<unknown>({ op: "resolve", ...opts }).then(() => {}),
    markThreadRead: (threadId: string) =>
      post<unknown>({ op: "read", threadId }).then(() => {}),
    markThreadUnread: (threadId: string) =>
      post<unknown>({ op: "unread", threadId }).then(() => {}),
  }
}
