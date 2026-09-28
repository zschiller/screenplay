"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { requireMember } from "@/lib/rooms"
import {
  appendComment,
  createThreadWithFirstComment,
  deleteComment as deleteCommentFn,
  deleteThread as deleteThreadFn,
  listBranchThreads as listBranchThreadsFn,
  listThreads as listThreadsFn,
  markThreadRead as markThreadReadFn,
  markThreadUnread as markThreadUnreadFn,
  setThreadResolved,
  type CommentRecord,
  type ThreadWithComments,
} from "@/lib/comments"
import {
  parseElementAnchor,
  routePath,
  snapshotLabel,
  type ElementAnchor,
} from "@/lib/comment-anchor"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"

export async function listThreadsAction(
  roomId: string
): Promise<ThreadWithComments[]> {
  const userId = await requireUserId()
  await requireMember(roomId, userId)
  return listThreadsFn(roomId, userId)
}

export async function listBranchThreadsAction(opts: {
  roomId: string
  branch: string
}): Promise<ThreadWithComments[]> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  return listBranchThreadsFn(opts.roomId, userId, opts.branch)
}

export async function createThreadAction(opts: {
  roomId: string
  x: number
  y: number
  iframeLayerId?: string | null
  selector?: string | null
  offsetX?: number | null
  offsetY?: number | null
  /** Frame-comment anchors (#785). */
  workspaceId?: string | null
  route?: string | null
  anchor?: ElementAnchor | null
  viewportWidth?: number | null
  viewportHeight?: number | null
  documentId?: string | null
  anchorStart?: string | null
  anchorEnd?: string | null
  quotedText?: string | null
  body: string
}): Promise<ThreadWithComments> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  const anchor = parseElementAnchor(opts.anchor)
  return createThreadWithFirstComment({
    workspaceId: shortString(opts.workspaceId, 256),
    route:
      typeof opts.route === "string" && opts.route.length <= 2048
        ? routePath(opts.route)
        : null,
    anchor,
    viewportWidth: finitePositive(opts.viewportWidth),
    viewportHeight: finitePositive(opts.viewportHeight),
    snapshot: snapshotLabel(anchor),
    roomId: opts.roomId,
    x: opts.x,
    y: opts.y,
    iframeLayerId: opts.iframeLayerId ?? null,
    selector: opts.selector ?? null,
    offsetX: opts.offsetX ?? null,
    offsetY: opts.offsetY ?? null,
    documentId: opts.documentId ?? null,
    anchorStart: opts.anchorStart ?? null,
    anchorEnd: opts.anchorEnd ?? null,
    quotedText: opts.quotedText ?? null,
    branch: null,
    body: trimmed,
    authorId: userId,
  })
}

export async function createBranchThreadAction(opts: {
  roomId: string
  branch: string
  body: string
}): Promise<ThreadWithComments> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  return createThreadWithFirstComment({
    roomId: opts.roomId,
    x: null,
    y: null,
    iframeLayerId: null,
    selector: null,
    offsetX: null,
    offsetY: null,
    branch: opts.branch,
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
  return appendComment({
    threadId: opts.threadId,
    authorId: userId,
    body: trimmed,
  })
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

export async function markThreadReadAction(threadId: string): Promise<void> {
  const userId = await requireUserId()
  await requireMembershipForThread(threadId, userId)
  await markThreadReadFn({ threadId, userId })
}

export async function markThreadUnreadAction(threadId: string): Promise<void> {
  const userId = await requireUserId()
  await requireMembershipForThread(threadId, userId)
  await markThreadUnreadFn({ threadId, userId })
}

function shortString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null
}
