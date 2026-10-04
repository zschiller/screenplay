import "server-only"

import { and, desc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getUsersByIds } from "@/lib/auth-helpers"
import type { ElementAnchor } from "@/lib/comment-anchor"
import type { AgentStatus } from "@/lib/comments-agent"
import { planBranchThreadMoves } from "@/lib/comment-migration"
import {
  canDeleteComment,
  canDeleteThread,
  canEditComment,
} from "@/lib/comment-permissions"
import { bumpCommentsRead, bumpCommentsRevision } from "@/lib/comments-signals"
import { db, schema } from "@/lib/db"
import { isLocalBuild } from "@/lib/local-mode"
import { openRoom, type RoomAccess, type RoomDoc } from "@/lib/room-access"

/**
 * **Comments**: the server side of comment threads. Every operation opens the
 * thread's Room through Room Access (so a non-member is refused before any
 * read or write), applies the same `comment-permissions` rules the thread card
 * reads, and rings the doorbell its change calls for. The server actions in
 * `comments-actions.ts` are transport only.
 *
 * Comments (the `thread`/`comment`/`thread_read` tables) are excluded from the
 * local desktop build (PRD #404, issue #417): those tables don't exist on disk
 * and the comment UI is not surfaced. This flag is the one place that decides
 * it: reads return empty so server components that pre-fetch threads render
 * cleanly, a person's writes refuse, and the agent's hooks do nothing.
 */
const commentsEnabled = !isLocalBuild

function requireCommentsEnabled(): void {
  if (!commentsEnabled) {
    throw new Error("Comments aren’t in the desktop app yet.")
  }
}

/** Thrown when someone edits or deletes what `comment-permissions` says
 *  isn't theirs. Every such case fails with this one error. */
export class NotYourCommentError extends Error {
  constructor() {
    super("Only its author can change this")
    this.name = "NotYourCommentError"
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

type ThreadRow = typeof schema.thread.$inferSelect

/**
 * Rings the room-global content doorbell: every connected client refetches
 * the thread list. Used for create/edit/delete/resolve. Server-side only so
 * we never trust client-bumped versions.
 */
async function signalContentChange(room: RoomDoc) {
  await room.mutateDoc(({ doc }) => bumpCommentsRevision(doc))
}

/**
 * Rings the per-user read doorbell: only the acting user's own tabs recompute
 * unread. Used for mark-read/mark-unread, which happen constantly and so must
 * not force a room-wide refetch storm.
 */
async function signalReadChange(room: RoomAccess) {
  await room.mutateDoc(({ doc }) => bumpCommentsRead(doc, room.userId))
}

/** Opens the Room a thread belongs to, for the current session. */
async function openThread(
  threadId: string
): Promise<{ room: RoomAccess; thread: ThreadRow }> {
  requireCommentsEnabled()
  const [thread] = await db
    .select()
    .from(schema.thread)
    .where(eq(schema.thread.id, threadId))
    .limit(1)
  if (!thread) throw new Error("Thread not found")
  return { room: await openRoom(thread.roomId), thread }
}

/** Opens the Room a comment's thread belongs to, for the current session. */
async function openComment(commentId: string): Promise<{
  room: RoomAccess
  comment: typeof schema.comment.$inferSelect
}> {
  requireCommentsEnabled()
  const [comment] = await db
    .select()
    .from(schema.comment)
    .where(eq(schema.comment.id, commentId))
    .limit(1)
  if (!comment) throw new Error("Comment not found")
  const { room } = await openThread(comment.threadId)
  return { room, comment }
}

async function authorOf(
  authorId: string
): Promise<{ name: string; image: string | null } | null> {
  const [author] = await getUsersByIds([authorId])
  return author ? { name: author.name, image: author.image } : null
}

/**
 * Every thread in a Canvas, newest first: frame, document and canvas threads,
 * and the Workspace threads made in the player (#789). The canvas and the
 * player read this one list, so they always show the same threads. Read only.
 */
export async function listThreads(
  roomId: string
): Promise<ThreadWithComments[]> {
  if (!commentsEnabled) return []
  const room = await openRoom(roomId)
  const threadRows = await placeFeedThreads(
    room,
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
          eq(schema.threadRead.userId, room.userId),
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

/**
 * Places the retired play-mode feed's threads (keyed by `branch`) on their
 * Workspace as they're listed (#789, see `lib/comment-migration.ts`). The
 * rows are left as stored: listing never writes. Rooms with no feed threads,
 * which is every Canvas made since #789, skip the room-doc read.
 */
async function placeFeedThreads(
  room: RoomAccess,
  rows: ThreadRow[]
): Promise<ThreadRow[]> {
  const feed = rows.flatMap((r) =>
    r.branch ? [{ id: r.id, branch: r.branch }] : []
  )
  if (feed.length === 0) return rows
  const workspaces = await room.readDoc(({ branches }) =>
    branches
      .toArray()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((b) => ({ id: b.id, ref: b.ref }))
  )
  const byId = new Map(
    planBranchThreadMoves(feed, workspaces).map((m) => [m.threadId, m])
  )
  return rows.map((r) => {
    const m = byId.get(r.id)
    return m
      ? { ...r, workspaceId: m.workspaceId, snapshot: m.snapshot, branch: null }
      : r
  })
}

export interface CreateThreadInput {
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
}

/**
 * Starts a thread with its first comment, as the current session's user. The
 * thread, the comment and the starter's read mark are one SQL statement, so
 * a failure leaves none of them (neon-http has no interactive transactions).
 */
export async function createThread(
  input: CreateThreadInput
): Promise<ThreadWithComments> {
  requireCommentsEnabled()
  const room = await openRoom(input.roomId)
  const body = requireBody(input.body)
  const threadId = nanoid()
  const commentId = nanoid()
  const now = new Date()

  const insertThread = db.$with("new_thread").as(
    db
      .insert(schema.thread)
      .values({
        id: threadId,
        roomId: room.roomId,
        x: input.x,
        y: input.y,
        iframeLayerId: input.iframeLayerId,
        selector: input.selector,
        offsetX: input.offsetX,
        offsetY: input.offsetY,
        workspaceId: input.workspaceId ?? null,
        route: input.route ?? null,
        anchor: input.anchor ?? null,
        viewportWidth: input.viewportWidth ?? null,
        viewportHeight: input.viewportHeight ?? null,
        snapshot: input.snapshot ?? null,
        documentId: input.documentId ?? null,
        anchorStart: input.anchorStart ?? null,
        anchorEnd: input.anchorEnd ?? null,
        quotedText: input.quotedText ?? null,
        createdBy: room.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.thread.id })
  )
  const insertComment = db.$with("new_comment").as(
    db
      .insert(schema.comment)
      .values({
        id: commentId,
        threadId,
        authorId: room.userId,
        body,
        createdAt: now,
      })
      .returning({ id: schema.comment.id })
  )
  // The starter has implicitly read their own thread.
  await db
    .with(insertThread, insertComment)
    .insert(schema.threadRead)
    .values({ threadId, userId: room.userId, lastReadAt: now })

  await signalContentChange(room)

  const [[threadRow], [commentRow]] = await Promise.all([
    db.select().from(schema.thread).where(eq(schema.thread.id, threadId)),
    db.select().from(schema.comment).where(eq(schema.comment.id, commentId)),
  ])
  if (!threadRow || !commentRow) throw new Error("Failed to create thread")
  return {
    ...toThread(threadRow),
    comments: [toComment(commentRow, await authorOf(room.userId))],
    unread: false,
  }
}

/** Replies in a thread. Any member may. */
export async function appendComment(opts: {
  threadId: string
  body: string
}): Promise<CommentRecord> {
  const { room } = await openThread(opts.threadId)
  const body = requireBody(opts.body)
  const [row] = await db
    .insert(schema.comment)
    .values({
      id: nanoid(),
      threadId: opts.threadId,
      authorId: room.userId,
      body,
    })
    .returning()
  if (!row) throw new Error("Failed to append comment")

  await db
    .update(schema.thread)
    .set({ updatedAt: new Date() })
    .where(eq(schema.thread.id, opts.threadId))
  await signalContentChange(room)

  return toComment(row, await authorOf(room.userId))
}

/** Edits a comment's body. Author only (`canEditComment`). */
export async function editComment(opts: {
  commentId: string
  body: string
}): Promise<void> {
  const { room, comment } = await openComment(opts.commentId)
  const body = requireBody(opts.body)
  const fromAgent = !!comment.agentChatId
  if (!canEditComment({ authorId: comment.authorId, fromAgent }, room.userId)) {
    throw new NotYourCommentError()
  }
  await db
    .update(schema.comment)
    .set({ body, editedAt: new Date() })
    .where(
      and(
        eq(schema.comment.id, comment.id),
        eq(schema.comment.authorId, room.userId),
        isNull(schema.comment.agentChatId)
      )
    )
  await signalContentChange(room)
}

/**
 * Deletes a comment. Author only (`canDeleteComment`). Deleting a thread's
 * last comment deletes the thread too, in the same statement, so no empty
 * pin is left behind.
 */
export async function deleteComment(opts: {
  commentId: string
}): Promise<void> {
  const { room, comment } = await openComment(opts.commentId)
  if (!canDeleteComment(comment, room.userId)) throw new NotYourCommentError()

  const removeComment = db
    .$with("removed_comment")
    .as(
      db
        .delete(schema.comment)
        .where(eq(schema.comment.id, comment.id))
        .returning({ id: schema.comment.id })
    )
  // The statement sees the thread as it was, so "no other comment" is the
  // test for this one being its last.
  await db
    .with(removeComment)
    .delete(schema.thread)
    .where(
      and(
        eq(schema.thread.id, comment.threadId),
        notExists(
          db
            .select({ id: schema.comment.id })
            .from(schema.comment)
            .where(
              and(
                eq(schema.comment.threadId, comment.threadId),
                ne(schema.comment.id, comment.id)
              )
            )
        )
      )
    )
  await signalContentChange(room)
}

/** Resolves or reopens a thread. Any member may. */
export async function setThreadResolved(opts: {
  threadId: string
  resolved: boolean
}): Promise<void> {
  const { room } = await openThread(opts.threadId)
  await db
    .update(schema.thread)
    .set({
      resolved: opts.resolved,
      resolvedAt: opts.resolved ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.thread.id, opts.threadId))
  await signalContentChange(room)
}

/** Deletes a thread and its comments. Only its starter may
 *  (`canDeleteThread`). */
export async function deleteThread(threadId: string): Promise<void> {
  const { room, thread } = await openThread(threadId)
  if (!canDeleteThread(thread, room.userId)) throw new NotYourCommentError()
  await db.delete(schema.thread).where(eq(schema.thread.id, threadId))
  await signalContentChange(room)
}

export async function markThreadRead(threadId: string): Promise<void> {
  const { room } = await openThread(threadId)
  await db
    .insert(schema.threadRead)
    .values({ threadId, userId: room.userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.threadRead.threadId, schema.threadRead.userId],
      set: { lastReadAt: sql`now()` },
    })
  // Ring only this user's read doorbell so their other tabs recompute unread,
  // without forcing every client in the room to refetch.
  await signalReadChange(room)
}

export async function markThreadUnread(threadId: string): Promise<void> {
  const { room } = await openThread(threadId)
  await db
    .delete(schema.threadRead)
    .where(
      and(
        eq(schema.threadRead.threadId, threadId),
        eq(schema.threadRead.userId, room.userId)
      )
    )
  // Per-user doorbell: only the acting user's tabs refresh their unread counts
  // (relevant when the same user has the room open elsewhere). A read-state
  // change is not a content change, so the room counter stays put.
  await signalReadChange(room)
}

function requireBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) throw new Error("Comment body is required")
  return trimmed
}

/**
 * Marks open threads as sent to a Workspace's agent (#788): `queued` on the
 * chat that carries the request, remembering HEAD so the commit the agent
 * makes can be told apart (`readBaseCommit`, which isn't called when there's
 * nothing to queue). Threads from another Canvas, or resolved since they were
 * picked, are left alone.
 */
export async function queueThreadsForAgent(opts: {
  room: RoomDoc
  threadIds: readonly string[]
  chatId: string
  readBaseCommit: () => Promise<string | null>
}): Promise<void> {
  if (!commentsEnabled || opts.threadIds.length === 0) return
  const baseCommit = await opts.readBaseCommit()
  const rows = await db
    .update(schema.thread)
    .set({
      agentStatus: "queued",
      agentChatId: opts.chatId,
      agentBaseCommit: baseCommit,
      agentCommit: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.thread.roomId, opts.room.roomId),
        inArray(schema.thread.id, [...opts.threadIds]),
        eq(schema.thread.resolved, false)
      )
    )
    .returning({ id: schema.thread.id })
  if (rows.length > 0) await signalContentChange(opts.room)
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
  if (!commentsEnabled) return []
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
  room: RoomDoc,
  chatId: string
): Promise<void> {
  if (!commentsEnabled) return
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
  if (rows.length > 0) await signalContentChange(room)
}

/**
 * Ends a request (#788): each addressed thread gets the agent's reply as a
 * comment and, when HEAD moved, the commit; `replies` holds one per thread.
 * Threads not in `replies` (the turn failed or was stopped) lose their status
 * so they can be sent again.
 */
export async function settleAgentThreads(opts: {
  room: RoomDoc
  chatId: string
  /** Whoever sent the request; the agent's replies are stored under them. */
  authorId: string
  replies: ReadonlyMap<string, { body: string; commit: string | null }>
  failed: readonly string[]
}): Promise<void> {
  if (!commentsEnabled) return
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
    await signalContentChange(opts.room)
  }
}

/** Every thread's pin number in a Canvas (see `threadNumbers`). */
export async function roomThreadOrder(
  roomId: string
): Promise<{ id: string; createdAt: number }[]> {
  if (!commentsEnabled) return []
  const rows = await db
    .select({ id: schema.thread.id, createdAt: schema.thread.createdAt })
    .from(schema.thread)
    .where(eq(schema.thread.roomId, roomId))
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.getTime() }))
}
