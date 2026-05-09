import "server-only"

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getUsersByIds } from "@/lib/auth-helpers"
import { db, schema } from "@/lib/db"
import { mutateRoomDoc } from "@/lib/yjs/server"

export type ThreadRecord = {
  id: string
  roomId: string
  /** Null for branch-level threads (no canvas position). */
  x: number | null
  y: number | null
  iframeLayerId: string | null
  selector: string | null
  offsetX: number | null
  offsetY: number | null
  /** Set on threads scoped to an agent branch (the player's flat feed). */
  branch: string | null
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
  unread: boolean
}

function toThread(row: typeof schema.thread.$inferSelect): ThreadRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    x: row.x,
    y: row.y,
    iframeLayerId: row.iframeLayerId,
    selector: row.selector,
    offsetX: row.offsetX,
    offsetY: row.offsetY,
    branch: row.branch,
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

/**
 * Shared loader. Filters threads either to the canvas (positional only —
 * `branch IS NULL`) or to a specific agent branch. Always orders threads
 * oldest→newest of the inner comments first; outer ordering is handled by
 * the caller via the `outerOrder` param.
 */
async function listThreadsScoped(
  roomId: string,
  userId: string,
  filter: { branch: string } | { positional: true },
  outerOrder: "asc" | "desc",
): Promise<ThreadWithComments[]> {
  const where =
    "branch" in filter
      ? and(
          eq(schema.thread.roomId, roomId),
          eq(schema.thread.branch, filter.branch),
        )
      : and(eq(schema.thread.roomId, roomId), isNull(schema.thread.branch))
  const threadRows = await db
    .select()
    .from(schema.thread)
    .where(where)
    .orderBy(
      outerOrder === "asc"
        ? asc(schema.thread.createdAt)
        : desc(schema.thread.createdAt),
    )
  if (threadRows.length === 0) return []

  const threadIds = threadRows.map((t) => t.id)
  const [commentRows, readRows] = await Promise.all([
    db
      .select()
      .from(schema.comment)
      .where(inArray(schema.comment.threadId, threadIds)),
    db
      .select()
      .from(schema.threadRead)
      .where(
        and(
          eq(schema.threadRead.userId, userId),
          inArray(schema.threadRead.threadId, threadIds),
        ),
      ),
  ])

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

  const lastReadByThread = new Map(
    readRows.map((r) => [r.threadId, r.lastReadAt.getTime()]),
  )

  return threadRows.map((t) => {
    const comments = byThread.get(t.id) ?? []
    const lastRead = lastReadByThread.get(t.id) ?? null
    const latestComment = comments.length
      ? comments[comments.length - 1]!.createdAt
      : 0
    const unread =
      comments.length > 0 && (lastRead === null || lastRead < latestComment)
    return {
      ...toThread(t),
      comments,
      unread,
    }
  })
}

/** Canvas threads: anchored to a position/iframeLayer/selector, branch null. */
export async function listThreads(
  roomId: string,
  userId: string,
): Promise<ThreadWithComments[]> {
  return listThreadsScoped(roomId, userId, { positional: true }, "desc")
}

/** Player threads: scoped to an agent branch, no canvas position. Returned
 *  oldest→newest so the player's flat feed reads chronologically. */
export async function listBranchThreads(
  roomId: string,
  userId: string,
  branch: string,
): Promise<ThreadWithComments[]> {
  return listThreadsScoped(roomId, userId, { branch }, "asc")
}

export async function createThreadWithFirstComment(opts: {
  roomId: string
  x: number | null
  y: number | null
  iframeLayerId: string | null
  selector: string | null
  offsetX: number | null
  offsetY: number | null
  branch: string | null
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
      iframeLayerId: opts.iframeLayerId,
      selector: opts.selector,
      offsetX: opts.offsetX,
      offsetY: opts.offsetY,
      branch: opts.branch,
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

  // Creator has implicitly read their own thread.
  await db.insert(schema.threadRead).values({
    threadId,
    userId: opts.authorId,
    lastReadAt: now,
  })

  await bumpCommentsRevision(opts.roomId)

  const [author] = await getUsersByIds([opts.authorId])
  return {
    ...toThread(threadRow),
    comments: [toComment(commentRow, author ? { name: author.name, image: author.image } : null)],
    unread: false,
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
  // If the thread is now empty, drop it so we don't leave an orphan pin.
  const [remaining] = await db
    .select({ id: schema.comment.id })
    .from(schema.comment)
    .where(eq(schema.comment.threadId, row.threadId))
    .limit(1)
  if (!remaining) {
    const [threadRow] = await db
      .delete(schema.thread)
      .where(eq(schema.thread.id, row.threadId))
      .returning({ roomId: schema.thread.roomId })
    if (threadRow) await bumpCommentsRevision(threadRow.roomId)
    return
  }
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

export async function markThreadRead(opts: {
  threadId: string
  userId: string
}): Promise<void> {
  await db
    .insert(schema.threadRead)
    .values({
      threadId: opts.threadId,
      userId: opts.userId,
      lastReadAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.threadRead.threadId, schema.threadRead.userId],
      set: { lastReadAt: sql`now()` },
    })
}

export async function markThreadUnread(opts: {
  threadId: string
  userId: string
}): Promise<void> {
  await db
    .delete(schema.threadRead)
    .where(
      and(
        eq(schema.threadRead.threadId, opts.threadId),
        eq(schema.threadRead.userId, opts.userId),
      ),
    )
  // Bump revision so other tabs/clients re-fetch and refresh their unread
  // counts (mostly relevant when the same user has the room open elsewhere).
  const [row] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, opts.threadId))
    .limit(1)
  if (row) await bumpCommentsRevision(row.roomId)
}
