import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getUsersByIds } from "@/lib/auth-helpers"
import { db, schema } from "@/lib/db"
import { mutateRoomDoc } from "@/lib/yjs/server"

export type ThreadRecord = {
  id: string
  roomId: string
  x: number
  y: number
  artboardId: string | null
  resolved: boolean
  resolvedAt: number | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type CommentRecord = {
  id: string
  threadId: string
  authorId: string
  authorName: string
  authorAvatar: string | null
  body: string
  createdAt: number
  editedAt: number | null
}

export type ThreadWithComments = ThreadRecord & {
  comments: CommentRecord[]
}

function toThread(row: typeof schema.thread.$inferSelect): ThreadRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    x: row.x,
    y: row.y,
    artboardId: row.artboardId,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function toComment(
  row: typeof schema.comment.$inferSelect,
  author: { name: string; image: string | null } | null,
): CommentRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    authorName: author?.name ?? "Anonymous",
    authorAvatar: author?.image ?? null,
    body: row.body,
    createdAt: row.createdAt.getTime(),
    editedAt: row.editedAt?.getTime() ?? null,
  }
}

/**
 * Bumps the room's comments revision counter inside the Y.Doc. Connected
 * clients observe the change and refetch the thread list. Server-side only
 * so we never trust client-bumped versions.
 */
async function bumpCommentsRevision(roomId: string) {
  await mutateRoomDoc(roomId, ({ doc }) => {
    const meta = doc.getMap("meta")
    const current = (meta.get("commentsRevision") as number | undefined) ?? 0
    meta.set("commentsRevision", current + 1)
  })
}

export async function listThreads(roomId: string): Promise<ThreadWithComments[]> {
  const threadRows = await db
    .select()
    .from(schema.thread)
    .where(eq(schema.thread.roomId, roomId))
    .orderBy(desc(schema.thread.createdAt))
  if (threadRows.length === 0) return []

  const threadIds = threadRows.map((t) => t.id)
  const commentRows = await db
    .select()
    .from(schema.comment)
    .where(inArray(schema.comment.threadId, threadIds))

  const authorIds = Array.from(new Set(commentRows.map((c) => c.authorId)))
  const authors = await getUsersByIds(authorIds)
  const authorById = new Map(authors.map((a) => [a.id, { name: a.name, image: a.image }]))

  const byThread = new Map<string, CommentRecord[]>()
  for (const row of commentRows) {
    const c = toComment(row, authorById.get(row.authorId) ?? null)
    const arr = byThread.get(c.threadId)
    if (arr) arr.push(c)
    else byThread.set(c.threadId, [c])
  }
  for (const arr of byThread.values()) {
    arr.sort((a, b) => a.createdAt - b.createdAt)
  }

  return threadRows.map((t) => ({
    ...toThread(t),
    comments: byThread.get(t.id) ?? [],
  }))
}

export async function createThreadWithFirstComment(opts: {
  roomId: string
  x: number
  y: number
  artboardId: string | null
  body: string
  authorId: string
}): Promise<ThreadWithComments> {
  const threadId = nanoid()
  const commentId = nanoid()
  const now = new Date()

  const [threadRow] = await db
    .insert(schema.thread)
    .values({
      id: threadId,
      roomId: opts.roomId,
      x: opts.x,
      y: opts.y,
      artboardId: opts.artboardId,
      createdBy: opts.authorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!threadRow) throw new Error("Failed to create thread")

  const [commentRow] = await db
    .insert(schema.comment)
    .values({
      id: commentId,
      threadId,
      authorId: opts.authorId,
      body: opts.body,
      createdAt: now,
    })
    .returning()
  if (!commentRow) throw new Error("Failed to create comment")

  await bumpCommentsRevision(opts.roomId)

  const [author] = await getUsersByIds([opts.authorId])
  return {
    ...toThread(threadRow),
    comments: [toComment(commentRow, author ? { name: author.name, image: author.image } : null)],
  }
}

export async function appendComment(opts: {
  threadId: string
  authorId: string
  body: string
}): Promise<CommentRecord> {
  const id = nanoid()
  const [row] = await db
    .insert(schema.comment)
    .values({
      id,
      threadId: opts.threadId,
      authorId: opts.authorId,
      body: opts.body,
    })
    .returning()
  if (!row) throw new Error("Failed to append comment")

  // Touch parent thread's updated_at and bump the room's revision.
  const [threadRow] = await db
    .update(schema.thread)
    .set({ updatedAt: new Date() })
    .where(eq(schema.thread.id, opts.threadId))
    .returning({ roomId: schema.thread.roomId })
  if (threadRow) await bumpCommentsRevision(threadRow.roomId)

  const [author] = await getUsersByIds([opts.authorId])
  return toComment(row, author ? { name: author.name, image: author.image } : null)
}

export async function editComment(opts: {
  commentId: string
  authorId: string
  body: string
}): Promise<void> {
  const [row] = await db
    .update(schema.comment)
    .set({ body: opts.body, editedAt: new Date() })
    .where(
      and(
        eq(schema.comment.id, opts.commentId),
        eq(schema.comment.authorId, opts.authorId),
      ),
    )
    .returning({ threadId: schema.comment.threadId })
  if (!row) throw new Error("Comment not found or not yours")

  const [threadRow] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, row.threadId))
    .limit(1)
  if (threadRow) await bumpCommentsRevision(threadRow.roomId)
}

export async function deleteComment(opts: {
  commentId: string
  authorId: string
}): Promise<void> {
  const [row] = await db
    .delete(schema.comment)
    .where(
      and(
        eq(schema.comment.id, opts.commentId),
        eq(schema.comment.authorId, opts.authorId),
      ),
    )
    .returning({ threadId: schema.comment.threadId })
  if (!row) return
  const [threadRow] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, row.threadId))
    .limit(1)
  if (threadRow) await bumpCommentsRevision(threadRow.roomId)
}

export async function setThreadResolved(opts: {
  threadId: string
  resolved: boolean
}): Promise<void> {
  const [row] = await db
    .update(schema.thread)
    .set({
      resolved: opts.resolved,
      resolvedAt: opts.resolved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.thread.id, opts.threadId))
    .returning({ roomId: schema.thread.roomId })
  if (row) await bumpCommentsRevision(row.roomId)
}

export async function deleteThread(threadId: string): Promise<void> {
  const [row] = await db
    .delete(schema.thread)
    .where(eq(schema.thread.id, threadId))
    .returning({ roomId: schema.thread.roomId })
  if (row) await bumpCommentsRevision(row.roomId)
}
