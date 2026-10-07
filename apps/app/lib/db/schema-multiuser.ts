import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import type { ElementAnchor } from "../comment-anchor"
import type { AgentStatus } from "../comments-agent"
import { room, user, type RoomRole } from "./schema-core"

// The **multi-user surface** (PRD #404, issue #417). These tables back GitHub
// OAuth login (`session`/`account`/`verification`), `room_member` sharing, and
// `thread`/`comment`/`thread_read` co-view. The hosted build keeps them all via
// `./schema.ts`, which re-exports this module alongside `./schema-core`. The
// desktop build excludes them: its PGlite migrations are generated from
// `schema-core` only (`drizzle/local`), and every code path that would touch
// them is gated off behind `@/lib/capabilities`' `multiUserSurface`.

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const roomMember = pgTable(
  "room_member",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<RoomRole>().notNull().default("editor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index("room_member_user_idx").on(t.userId),
  ]
)

export const thread = pgTable(
  "thread",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "cascade" }),
    // Coordinates are canvas-space, or frame-space on a frame thread
    // (iframeLayerId set, or workspace_id alone for one made in the player).
    // When a selector is set, x/y is the last known resolved position used as
    // a fallback if the selector no longer matches an element. Null on the
    // old play-mode feed's threads (no position).
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    iframeLayerId: text("iframe_layer_id"),
    // CSS path to the iframe DOM element the comment is anchored to (iframeLayer
    // comments only). offset_x/y are stored as fractions of the element's
    // width/height (0–1) at click time, so the pin tracks the same relative
    // point on the element as the layout reflows or resizes.
    selector: text("selector"),
    offsetX: doublePrecision("offset_x"),
    offsetY: doublePrecision("offset_y"),
    // Frame-comment anchors (#785), most durable first: the Workspace the
    // frame showed (so the comment outlives its frame), the route it was on
    // (the pin shows only there), the element by id / test id / text / path
    // (`selector` keeps the path for older clients), and the viewport it was
    // made in plus a short text snapshot of the element, which a detached
    // comment is listed with. All null on threads made before #785.
    workspaceId: text("workspace_id"),
    route: text("route"),
    anchor: jsonb("anchor").$type<ElementAnchor>(),
    viewportWidth: doublePrecision("viewport_width"),
    viewportHeight: doublePrecision("viewport_height"),
    snapshot: text("snapshot"),
    // Inline document-layer anchor. When set, the thread is anchored to a
    // text range inside a TipTap/Yjs document (Notion-style doc layer), not
    // an iframe DOM element. anchor_start / anchor_end are base64-encoded
    // Y.RelativePosition values from the document's Y.XmlFragment, so the
    // anchor tracks the same logical span across concurrent edits. quoted_
    // text is a snapshot of the selected text at create time — used in the
    // thread header and in the "Send to Claude" payload, and as a fallback
    // when the relative positions can no longer resolve (range fully
    // deleted). Mutually exclusive with `selector` (artboard anchor).
    documentId: text("document_id"),
    anchorStart: text("anchor_start"),
    anchorEnd: text("anchor_end"),
    quotedText: text("quoted_text"),
    // Retired (#789). Play mode's old flat feed keyed its threads
    // by the Workspace's branch name. Nothing writes it now: listing a room's
    // threads places any left over on their Workspace (see
    // `lib/comment-migration.ts`).
    branch: text("branch"),
    // Sent to the Workspace's agent (#788): where the request stands
    // (`queued`, `working`, `addressed`; null when never sent or the run
    // failed), the chat that carries it, HEAD when it was sent, and the
    // commit the agent made for it once addressed.
    agentStatus: text("agent_status").$type<AgentStatus>(),
    agentChatId: text("agent_chat_id"),
    agentBaseCommit: text("agent_base_commit"),
    agentCommit: text("agent_commit"),
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("thread_room_idx").on(t.roomId),
    index("thread_room_branch_idx").on(t.roomId, t.branch),
    index("thread_document_idx").on(t.documentId),
  ]
)

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    // Set when the Workspace's agent wrote this reply (#788): the chat it came
    // from. `author_id` is then whoever sent the thread to the agent.
    agentChatId: text("agent_chat_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    editedAt: timestamp("edited_at"),
  },
  (t) => [index("comment_thread_idx").on(t.threadId)]
)

// Per-user thread read tracking. A thread is unread for user U when no row
// exists for (thread, U), or when last_read_at is older than the most recent
// comment in the thread. "Mark as unread" deletes the row.
export const threadRead = pgTable(
  "thread_read",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index("thread_read_user_idx").on(t.userId),
  ]
)
