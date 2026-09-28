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
import {
  parseElementAnchor,
  routePath,
  snapshotLabel,
  type ElementAnchor,
} from "@/lib/comment-anchor"

// Transport only: access, permissions and the local build are the Comments
// module's (`lib/comments.ts`). These parse what the browser sends.

export async function listThreadsAction(
  roomId: string
): Promise<ThreadWithComments[]> {
  return listThreads(roomId)
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
  const anchor = parseElementAnchor(opts.anchor)
  return createThread({
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
    body: opts.body,
  })
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
