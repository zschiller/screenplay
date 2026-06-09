import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import { room, user, type RoomRole } from "./schema-core"

// The **multi-user surface** (PRD #404, issue #417). These tables back GitHub
// OAuth login (`session`/`account`/`verification`), `room_member` sharing, and
// `thread`/`comment`/`thread_read` co-view. The hosted build keeps them all via
// `./schema.ts`, which re-exports this module alongside `./schema-core`. The
// desktop build excludes them: its PGlite migrations are generated from
// `schema-core` only (`drizzle/local`), and every code path that would touch
// them is gated off behind `@/lib/local-mode`'s `isLocalBuild`.

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
    // Coordinates are canvas-space (or iframeLayer-space when iframeLayerId is set).
    // When a selector is set, x/y is the last known resolved position used as
    // a fallback if the selector no longer matches an element. Null on
    // branch-level threads (no canvas position).
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
    // Set on threads scoped to an agent branch (the prototype player's flat
    // comment feed). Mutually exclusive with the positional fields above —
    // canvas threads have branch null, branch threads have x/y/iframeLayerId/
    // selector all null.
    branch: text("branch"),
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
