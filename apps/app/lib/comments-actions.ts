"use server"

import {
  appendComment,
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  listThreads,
  markThreadRead,
  markThreadUnread,
  setThreadResolved,
  type CommentRecord,
  type ThreadWithComments,
} from "@/lib/comments"
import { parseNewThread, type NewThreadInput } from "@/lib/comment-input"

// Transport only: access, permissions and the local build are the Comments
// module's (`lib/comments.ts`). These parse what the browser sends.

export async function listThreadsAction(
  roomId: string
): Promise<ThreadWithComments[]> {
  return listThreads(roomId)
}

export async function createThreadAction(
  opts: NewThreadInput & { roomId: string }
): Promise<ThreadWithComments> {
  return createThread({ ...parseNewThread(opts), roomId: opts.roomId })
}

export async function appendCommentAction(opts: {
  threadId: string
  body: string
}): Promise<CommentRecord> {
  return appendComment({ threadId: opts.threadId, body: opts.body })
}

export async function editCommentAction(opts: {
  commentId: string
  body: string
}): Promise<void> {
  await editComment({ commentId: opts.commentId, body: opts.body })
}

export async function deleteCommentAction(opts: {
  commentId: string
}): Promise<void> {
  await deleteComment({ commentId: opts.commentId })
}

export async function setThreadResolvedAction(opts: {
  threadId: string
  resolved: boolean
}): Promise<void> {
  await setThreadResolved({
    threadId: opts.threadId,
    resolved: opts.resolved,
  })
}

export async function deleteThreadAction(threadId: string): Promise<void> {
  await deleteThread(threadId)
}

export async function markThreadReadAction(threadId: string): Promise<void> {
  await markThreadRead(threadId)
}

export async function markThreadUnreadAction(threadId: string): Promise<void> {
  await markThreadUnread(threadId)
}
