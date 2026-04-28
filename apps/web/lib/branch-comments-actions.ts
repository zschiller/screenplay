"use server"

import { eq } from "drizzle-orm"
import { requireUserId } from "@/lib/auth-helpers"
import { requireMember } from "@/lib/rooms"
import {
  createBranchComment,
  deleteBranchComment as deleteBranchCommentFn,
  editBranchComment as editBranchCommentFn,
  listBranchComments,
  type BranchCommentRecord,
} from "@/lib/branch-comments"
import { db, schema } from "@/lib/db"

export async function listBranchCommentsAction(opts: {
  roomId: string
  branch: string
}): Promise<BranchCommentRecord[]> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  return listBranchComments(opts.roomId, opts.branch)
}

export async function createBranchCommentAction(opts: {
  roomId: string
  branch: string
  body: string
}): Promise<BranchCommentRecord> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  return createBranchComment({
    roomId: opts.roomId,
    branch: opts.branch,
    authorId: userId,
    body: trimmed,
  })
}

async function requireMembershipForBranchComment(
  commentId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ roomId: schema.branchComment.roomId })
    .from(schema.branchComment)
    .where(eq(schema.branchComment.id, commentId))
    .limit(1)
  if (!row) throw new Error("Comment not found")
  await requireMember(row.roomId, userId)
}

export async function editBranchCommentAction(opts: {
  commentId: string
  body: string
}): Promise<void> {
  const userId = await requireUserId()
  await requireMembershipForBranchComment(opts.commentId, userId)
  const trimmed = opts.body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  await editBranchCommentFn({ commentId: opts.commentId, authorId: userId, body: trimmed })
}

export async function deleteBranchCommentAction(opts: {
  commentId: string
}): Promise<void> {
  const userId = await requireUserId()
  await requireMembershipForBranchComment(opts.commentId, userId)
  await deleteBranchCommentFn({ commentId: opts.commentId, authorId: userId })
}
