import "server-only"

import { and, asc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getUsersByIds } from "@/lib/auth-helpers"
import { db, schema } from "@/lib/db"

export type BranchCommentRecord = {
  id: string
  roomId: string
  branch: string
  authorId: string
  authorName: string
  authorAvatar: string | null
  body: string
  createdAt: number
  editedAt: number | null
}

function toRecord(
  row: typeof schema.branchComment.$inferSelect,
  author: { name: string; image: string | null } | null,
): BranchCommentRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    branch: row.branch,
    authorId: row.authorId,
    authorName: author?.name ?? "Anonymous",
    authorAvatar: author?.image ?? null,
    body: row.body,
    createdAt: row.createdAt.getTime(),
    editedAt: row.editedAt?.getTime() ?? null,
  }
}

export async function listBranchComments(
  roomId: string,
  branch: string,
): Promise<BranchCommentRecord[]> {
  const rows = await db
    .select()
    .from(schema.branchComment)
    .where(
      and(
        eq(schema.branchComment.roomId, roomId),
        eq(schema.branchComment.branch, branch),
      ),
    )
    .orderBy(asc(schema.branchComment.createdAt))
  if (rows.length === 0) return []
  const authorIds = Array.from(new Set(rows.map((r) => r.authorId)))
  const authors = await getUsersByIds(authorIds)
  const byId = new Map(authors.map((a) => [a.id, { name: a.name, image: a.image }]))
  return rows.map((r) => toRecord(r, byId.get(r.authorId) ?? null))
}

export async function createBranchComment(opts: {
  roomId: string
  branch: string
  authorId: string
  body: string
}): Promise<BranchCommentRecord> {
  const id = nanoid()
  const [row] = await db
    .insert(schema.branchComment)
    .values({
      id,
      roomId: opts.roomId,
      branch: opts.branch,
      authorId: opts.authorId,
      body: opts.body,
    })
    .returning()
  if (!row) throw new Error("Failed to create branch comment")
  const [author] = await getUsersByIds([opts.authorId])
  return toRecord(row, author ? { name: author.name, image: author.image } : null)
}

export async function editBranchComment(opts: {
  commentId: string
  authorId: string
  body: string
}): Promise<void> {
  const [row] = await db
    .update(schema.branchComment)
    .set({ body: opts.body, editedAt: new Date() })
    .where(
      and(
        eq(schema.branchComment.id, opts.commentId),
        eq(schema.branchComment.authorId, opts.authorId),
      ),
    )
    .returning({ id: schema.branchComment.id })
  if (!row) throw new Error("Comment not found or not yours")
}

export async function deleteBranchComment(opts: {
  commentId: string
  authorId: string
}): Promise<void> {
  await db
    .delete(schema.branchComment)
    .where(
      and(
        eq(schema.branchComment.id, opts.commentId),
        eq(schema.branchComment.authorId, opts.authorId),
      ),
    )
}
