import "server-only"

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getUsersByIds } from "@/lib/auth-helpers"
import type { ElementAnchor } from "@/lib/comment-anchor"
import type { AgentStatus } from "@/lib/comments-agent"
import { planBranchThreadMoves } from "@/lib/comment-migration"
import { bumpCommentsRead, bumpCommentsRevision } from "@/lib/comments-signals"
import { db, schema } from "@/lib/db"
import { isLocalBuild } from "@/lib/local-mode"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"

// Comments (the `thread`/`comment`/`thread_read` tables) are excluded from the
// local desktop build (PRD #404, issue #417): those tables don't exist on disk
// and the comment UI is not surfaced. Reads return empty so server components
// that pre-fetch threads render cleanly; writes refuse as a backstop.
function assertCommentsEnabled(): void {
  if (isLocalBuild) {
    throw new Error("Comments are not available in the local build")
  }
}

export type ThreadRecord = {
  id: string
  roomId: string
  /** Null when the thread has no point: a note from the retired play-mode
   *  feed (#789), or a thread on a document. */
  x: number | null
  y: number | null
  iframeLayerId: string | null
  selector: string | null
  offsetX: number | null
  offsetY: number | null
  /** Frame-comment anchors (#785): see `lib/comment-anchor.ts`. Null on
   *  threads made before them. */
  workspaceId: string | null
  route: string | null
  anchor: ElementAnchor | null
  viewportWidth: number | null
  viewportHeight: number | null
  snapshot: string | null
  /** Inline document-layer anchor. When `documentId` is set the thread is
   *  anchored to a text range inside a TipTap doc (Notion-style layer);
   *  `anchorStart`/`anchorEnd` are base64-encoded Y.RelativePosition values
   *  and `quotedText` is the captured text at create time. */
  documentId: string | null
  anchorStart: string | null
  anchorEnd: string | null
  quotedText: string | null
  /** Sent to the Workspace's agent (#788): where that stands, and the commit
   *  it made once addressed. */
  agentStatus: AgentStatus | null
  agentCommit: string | null
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
  /** Written by the Workspace's agent in reply to a request (#788). */
  fromAgent: boolean
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
    workspaceId: row.workspaceId,
    route: row.route,
    anchor: row.anchor ?? null,
    viewportWidth: row.viewportWidth,
    viewportHeight: row.viewportHeight,
    snapshot: row.snapshot,
    documentId: row.documentId,
    anchorStart: row.anchorStart,
    anchorEnd: row.anchorEnd,
    quotedText: row.quotedText,
    agentStatus: row.agentStatus ?? null,
    agentCommit: row.agentCommit,
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function toComment(
  row: typeof schema.comment.$inferSelect,
  author: { name: string; image: string | null } | null
): CommentRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    // The agent's replies are stored under whoever sent the request, but are
    // the agent's words.
    authorName: row.agentChatId ? "Agent" : (author?.name ?? "Anonymous"),
    authorAvatar: row.agentChatId ? null : (author?.image ?? null),
    body: row.body,
    fromAgent: !!row.agentChatId,
    createdAt: row.createdAt.getTime(),
    editedAt: row.editedAt?.getTime() ?? null,
  }
}

/**
 * Rings the room-global content doorbell: every connected client refetches
 * the thread list. Used for create/edit/delete/resolve. Server-side only so
 * we never trust client-bumped versions.
 */
async function signalContentChange(roomId: string) {
  await mutateRoomDoc(roomId, ({ doc }) => bumpCommentsRevision(doc))
}

/**
 * Rings the per-user read doorbell: only the acting user's own tabs recompute
 * unread. Used for mark-read/mark-unread, which happen constantly and so must
 * not force a room-wide refetch storm.
 */
async function signalReadChange(roomId: string, userId: string) {
  await mutateRoomDoc(roomId, ({ doc }) => bumpCommentsRead(doc, userId))
}

/**
 * Every thread in a Canvas, newest first: frame, document and canvas threads,
 * and the Workspace threads made in the player (#789). The canvas and the
 * player read this one list, so they always show the same threads.
 */
export async function listThreads(
  roomId: string,
  userId: string
): Promise<ThreadWithComments[]> {
  if (isLocalBuild) return []
  const threadRows = await moveFeedThreads(
    roomId,
    await db
      .select()
      .from(schema.thread)
      .where(eq(schema.thread.roomId, roomId))
      .orderBy(desc(schema.thread.createdAt))
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
          inArray(schema.threadRead.threadId, threadIds)
        )
      ),
  ])

  const authorIds = Array.from(new Set(commentRows.map((c) => c.authorId)))
  const authors = await getUsersByIds(authorIds)
  const authorById = new Map(
    authors.map((a) => [a.id, { name: a.name, image: a.image }])
  )

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
    readRows.map((r) => [r.threadId, r.lastReadAt.getTime()])
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

type ThreadRow = typeof schema.thread.$inferSelect

/**
 * Moves the retired play-mode feed's threads (keyed by `branch`) onto their
 * Workspace, the first time a room's threads are listed after #789 (see
 * `lib/comment-migration.ts`). Returns the rows as they now stand. Once a
 * room's feed threads have moved none carry a branch, so this costs nothing
 * on every later list.
 */
async function moveFeedThreads(
  roomId: string,
  rows: ThreadRow[]
): Promise<ThreadRow[]> {
  const feed = rows.flatMap((r) =>
    r.branch ? [{ id: r.id, branch: r.branch }] : []
  )
  if (feed.length === 0) return rows
  const workspaces = await readRoomDoc(roomId, ({ branches }) =>
    branches
      .toArray()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((b) => ({ id: b.id, ref: b.ref }))
  )
  const moves = planBranchThreadMoves(feed, workspaces)
  await Promise.all(
    moves.map((m) =>
      db
        .update(schema.thread)
        .set({ workspaceId: m.workspaceId, snapshot: m.snapshot, branch: null })
        .where(eq(schema.thread.id, m.threadId))
    )
  )
  const byId = new Map(moves.map((m) => [m.threadId, m]))
  return rows.map((r) => {
    const m = byId.get(r.id)
    return m
      ? { ...r, workspaceId: m.workspaceId, snapshot: m.snapshot, branch: null }
      : r
  })
}

export async function createThreadWithFirstComment(opts: {
  roomId: string
  x: number | null
  y: number | null
  iframeLayerId: string | null
  selector: string | null
  offsetX: number | null
  offsetY: number | null
  workspaceId?: string | null
  route?: string | null
  anchor?: ElementAnchor | null
  viewportWidth?: number | null
  viewportHeight?: number | null
  snapshot?: string | null
  documentId?: string | null
  anchorStart?: string | null
  anchorEnd?: string | null
  quotedText?: string | null
  body: string
  authorId: string
}): Promise<ThreadWithComments> {
  assertCommentsEnabled()
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
      workspaceId: opts.workspaceId ?? null,
      route: opts.route ?? null,
      anchor: opts.anchor ?? null,
      viewportWidth: opts.viewportWidth ?? null,
      viewportHeight: opts.viewportHeight ?? null,
      snapshot: opts.snapshot ?? null,
      documentId: opts.documentId ?? null,
      anchorStart: opts.anchorStart ?? null,
      anchorEnd: opts.anchorEnd ?? null,
      quotedText: opts.quotedText ?? null,
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

  await signalContentChange(opts.roomId)

  const [author] = await getUsersByIds([opts.authorId])
  return {
    ...toThread(threadRow),
    comments: [
      toComment(
        commentRow,
        author ? { name: author.name, image: author.image } : null
      ),
    ],
    unread: false,
  }
}

export async function appendComment(opts: {
  threadId: string
  authorId: string
  body: string
}): Promise<CommentRecord> {
  assertCommentsEnabled()
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
  if (threadRow) await signalContentChange(threadRow.roomId)

  const [author] = await getUsersByIds([opts.authorId])
  return toComment(
    row,
    author ? { name: author.name, image: author.image } : null
  )
}

export async function editComment(opts: {
  commentId: string
  authorId: string
  body: string
}): Promise<void> {
  assertCommentsEnabled()
  const [row] = await db
    .update(schema.comment)
    .set({ body: opts.body, editedAt: new Date() })
    .where(
      and(
        eq(schema.comment.id, opts.commentId),
        eq(schema.comment.authorId, opts.authorId),
        isNull(schema.comment.agentChatId)
      )
    )
    .returning({ threadId: schema.comment.threadId })
  if (!row) throw new Error("Comment not found or not yours")

  const [threadRow] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, row.threadId))
    .limit(1)
  if (threadRow) await signalContentChange(threadRow.roomId)
}

export async function deleteComment(opts: {
  commentId: string
  authorId: string
}): Promise<void> {
  assertCommentsEnabled()
  const [row] = await db
    .delete(schema.comment)
    .where(
      and(
        eq(schema.comment.id, opts.commentId),
        eq(schema.comment.authorId, opts.authorId)
      )
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
    if (threadRow) await signalContentChange(threadRow.roomId)
    return
  }
  const [threadRow] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, row.threadId))
    .limit(1)
  if (threadRow) await signalContentChange(threadRow.roomId)
}

export async function setThreadResolved(opts: {
  threadId: string
  resolved: boolean
}): Promise<void> {
  assertCommentsEnabled()
  const [row] = await db
    .update(schema.thread)
    .set({
      resolved: opts.resolved,
      resolvedAt: opts.resolved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.thread.id, opts.threadId))
    .returning({ roomId: schema.thread.roomId })
  if (row) await signalContentChange(row.roomId)
}

/** Deletes a thread and its comments. Only the thread's starter may, as
 *  `canDeleteThread` says; anyone else gets an error and nothing changes. */
export async function deleteThread(opts: {
  threadId: string
  userId: string
}): Promise<void> {
  assertCommentsEnabled()
  const [row] = await db
    .delete(schema.thread)
    .where(
      and(
        eq(schema.thread.id, opts.threadId),
        eq(schema.thread.createdBy, opts.userId)
      )
    )
    .returning({ roomId: schema.thread.roomId })
  if (!row) throw new Error("Thread not found or not yours")
  await signalContentChange(row.roomId)
}

export async function markThreadRead(opts: {
  threadId: string
  userId: string
}): Promise<void> {
  assertCommentsEnabled()
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
  // Ring only this user's read doorbell so their other tabs recompute unread,
  // without forcing every client in the room to refetch.
  const [row] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, opts.threadId))
    .limit(1)
  if (row) await signalReadChange(row.roomId, opts.userId)
}

export async function markThreadUnread(opts: {
  threadId: string
  userId: string
}): Promise<void> {
  assertCommentsEnabled()
  await db
    .delete(schema.threadRead)
    .where(
      and(
        eq(schema.threadRead.threadId, opts.threadId),
        eq(schema.threadRead.userId, opts.userId)
      )
    )
  // Per-user doorbell: only the acting user's tabs refresh their unread counts
  // (relevant when the same user has the room open elsewhere). A read-state
  // change is not a content change, so the room counter stays put.
  const [row] = await db
    .select({ roomId: schema.thread.roomId })
    .from(schema.thread)
    .where(eq(schema.thread.id, opts.threadId))
    .limit(1)
  if (row) await signalReadChange(row.roomId, opts.userId)
}

/**
 * Marks open threads as sent to a Workspace's agent (#788): `queued` on the
 * chat that carries the request, remembering HEAD so the commit the agent
 * makes can be told apart. Threads from another Canvas, or resolved since
 * they were picked, are left alone.
 */
export async function queueThreadsForAgent(opts: {
  roomId: string
  threadIds: readonly string[]
  chatId: string
  baseCommit: string | null
}): Promise<void> {
  if (isLocalBuild || opts.threadIds.length === 0) return
  const rows = await db
    .update(schema.thread)
    .set({
      agentStatus: "queued",
      agentChatId: opts.chatId,
      agentBaseCommit: opts.baseCommit,
      agentCommit: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.thread.roomId, opts.roomId),
        inArray(schema.thread.id, [...opts.threadIds]),
        eq(schema.thread.resolved, false)
      )
    )
    .returning({ id: schema.thread.id })
  if (rows.length > 0) await signalContentChange(opts.roomId)
}

/** The threads a chat's agent still owes a reply: queued or working. */
export async function pendingAgentThreads(chatId: string): Promise<
  {
    id: string
    roomId: string
    agentStatus: AgentStatus | null
    agentBaseCommit: string | null
  }[]
> {
  if (isLocalBuild) return []
  return db
    .select({
      id: schema.thread.id,
      roomId: schema.thread.roomId,
      agentStatus: schema.thread.agentStatus,
      agentBaseCommit: schema.thread.agentBaseCommit,
    })
    .from(schema.thread)
    .where(
      and(
        eq(schema.thread.agentChatId, chatId),
        inArray(schema.thread.agentStatus, ["queued", "working"])
      )
    )
}

/** Moves a chat's queued threads to `working` as its agent's turn starts. */
export async function startAgentThreads(
  roomId: string,
  chatId: string
): Promise<void> {
  if (isLocalBuild) return
  const rows = await db
    .update(schema.thread)
    .set({ agentStatus: "working" })
    .where(
      and(
        eq(schema.thread.agentChatId, chatId),
        eq(schema.thread.agentStatus, "queued")
      )
    )
    .returning({ id: schema.thread.id })
  if (rows.length > 0) await signalContentChange(roomId)
}

/**
 * Ends a request (#788): each addressed thread gets the agent's reply as a
 * comment and, when HEAD moved, the commit; `replies` holds one per thread.
 * Threads not in `replies` (the turn failed or was stopped) lose their status
 * so they can be sent again.
 */
export async function settleAgentThreads(opts: {
  roomId: string
  chatId: string
  /** Whoever sent the request; the agent's replies are stored under them. */
  authorId: string
  replies: ReadonlyMap<string, { body: string; commit: string | null }>
  failed: readonly string[]
}): Promise<void> {
  if (isLocalBuild) return
  const now = new Date()
  for (const [threadId, reply] of opts.replies) {
    if (reply.body) {
      await db.insert(schema.comment).values({
        id: nanoid(),
        threadId,
        authorId: opts.authorId,
        body: reply.body,
        agentChatId: opts.chatId,
        createdAt: now,
      })
    }
    await db
      .update(schema.thread)
      .set({
        agentStatus: "addressed",
        agentCommit: reply.commit,
        updatedAt: now,
      })
      .where(eq(schema.thread.id, threadId))
  }
  if (opts.failed.length > 0) {
    await db
      .update(schema.thread)
      .set({ agentStatus: null, agentChatId: null, agentBaseCommit: null })
      .where(inArray(schema.thread.id, [...opts.failed]))
  }
  if (opts.replies.size > 0 || opts.failed.length > 0) {
    await signalContentChange(opts.roomId)
  }
}

/** Every thread's pin number in a Canvas (see `threadNumbers`). */
export async function roomThreadOrder(
  roomId: string
): Promise<{ id: string; createdAt: number }[]> {
  if (isLocalBuild) return []
  const rows = await db
    .select({ id: schema.thread.id, createdAt: schema.thread.createdAt })
    .from(schema.thread)
    .where(eq(schema.thread.roomId, roomId))
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.getTime() }))
}
