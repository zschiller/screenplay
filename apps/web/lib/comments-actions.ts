"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { requireMember } from "@/lib/rooms"
import {
  appendComment,
  createThreadWithFirstComment,
  deleteComment as deleteCommentFn,
  deleteThread as deleteThreadFn,
  editComment as editCommentFn,
  listThreads as listThreadsFn,
  setThreadResolved,
  type CommentRecord,
  type ThreadWithComments,
} from "@/lib/comments"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"

export async function listThreadsAction(
  roomId: string,
): Promise<ThreadWithComments[]> {
  const userId = await requireUserId()
  await requireMember(roomId, userId)
  return listThreadsFn(roomId)
}

export async function createThreadAction(opts: {
  roomId: string
  x: number
  y: number
  artboardId?: string | null
  body: string
}): Promise<ThreadWithComments> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  return createThreadWithFirstComment({
    roomId: opts.roomId,
    x: opts.x,
    y: opts.y,
    artboardId: opts.artboardId ?? null,
    body: trimmed,
    authorId: userId,
  })
}

async function requireMembershipForThread(threadId: string, userId: string) {
  const [row] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, threadId))
    .limit(1)
  if (!row) throw new Error("Thread not found")
  await requireMember(row.roomId, userId)
  return row.roomId
}

export async function appendCommentAction(opts: {
  threadId: string
  body: string
}): Promise<CommentRecord> {
  const userId = await requireUserId()
  await requireMembershipForThread(opts.threadId, userId)
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  return appendComment({ threadId: opts.threadId, authorId: userId, body: trimmed })
}

export async function editCommentAction(opts: {
  commentId: string
  body: string
}): Promise<void> {
  const userId = await requireUserId()
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  await editCommentFn({ commentId: opts.commentId, authorId: userId, body: trimmed })
}

export async function deleteCommentAction(opts: {
  commentId: string
}): Promise<void> {
  const userId = await requireUserId()
  await deleteCommentFn({ commentId: opts.commentId, authorId: userId })
}

export async function setThreadResolvedAction(opts: {
  threadId: string
  resolved: boolean
}): Promise<void> {
  const userId = await requireUserId()
  await requireMembershipForThread(opts.threadId, userId)
  await setThreadResolved({ threadId: opts.threadId, resolved: opts.resolved })
}

export async function deleteThreadAction(threadId: string): Promise<void> {
  const userId = await requireUserId()
  await requireMembershipForThread(threadId, userId)
  await deleteThreadFn(threadId)
}
