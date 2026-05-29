import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import type { OrganizationState } from "@/lib/organization"

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Per-user folder/file organization state (folders, pins, file→folder map).
  organization: jsonb("organization").$type<OrganizationState | null>(),
})

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

// Generic key-value store backing lib/kv. Values are stored as JSONB so the
// adapter can transparently round-trip strings, numbers, and JSON objects.
// `expires_at` is NULL for persistent entries; cached/lock entries set it and
// the adapter treats rows past their expiry as absent.
export const kvStore = pgTable("kv_store", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  expiresAt: timestamp("expires_at"),
})

export const room = pgTable("room", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("Untitled"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Last time a member opened the room — surfaced in the projects list.
  lastOpenedAt: timestamp("last_opened_at"),
  thumbnailUrl: text("thumbnail_url"),
  thumbnailUpdatedAt: timestamp("thumbnail_updated_at"),
})

export type RoomRole = "owner" | "editor" | "viewer"

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
  ],
)

import { doublePrecision } from "drizzle-orm/pg-core"

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
  ],
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
  (t) => [index("comment_thread_idx").on(t.threadId)],
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
  ],
)

// Agent persistence — backs the streamText tool loop in lib/agent/engine.ts.

import type { ModelMessage } from "ai"

// One row per chat. `id` matches the chatId stored in the room's Y.Doc
// (`chatSessions` collection) so the canvas/player UIs and the agent's
// message log share the same key.
export const agentChat = pgTable(
  "agent_chat",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    sandboxName: text("sandbox_name").notNull(),
    model: text("model").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("agent_chat_room_idx").on(t.roomId)],
)

// Append-only UIMessage log. Stored as a single JSONB blob per message so we
// can hand it straight to/from the AI SDK without flattening parts into rows.
export const agentMessage = pgTable(
  "agent_message",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => agentChat.id, { onDelete: "cascade" }),
    role: text("role").$type<ModelMessage["role"]>().notNull(),
    message: jsonb("message").$type<ModelMessage>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("agent_message_chat_idx").on(t.chatId, t.createdAt)],
)

// Tracks an in-flight ToolLoopAgent invocation. The stream route inserts a row
// at start, the stop route flips `aborted=true`, and the loop checks it
// between steps via prepareStep. `endedAt` is set when the loop exits.
export const agentRun = pgTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => agentChat.id, { onDelete: "cascade" }),
    // Expand phase of the run-lifecycle migration (#167): the four truthful
    // terminal values land *alongside* the legacy `ended` so old code paths
    // keep working until the contract slice (#170) retires `ended` and the
    // `aborted` column. The enum is enforced only in TypeScript — `status` is
    // a plain `text` column — so widening it generates no SQL migration.
    status: text("status")
      .$type<
        | "running"
        | "paused_for_plan"
        | "ended"
        | "completed"
        | "failed"
        | "aborted"
        | "superseded"
      >()
      .notNull()
      .default("running"),
    aborted: boolean("aborted").notNull().default(false),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [index("agent_run_chat_idx").on(t.chatId, t.startedAt)],
)

// Captures a tool call that's waiting on the user (currently only
// submit_plan). `id` is the AI SDK tool-call id verbatim — the same value
// flows through the `plan_submitted` broadcast and the history-route
// reconstruction path, so the planId the client holds always resolves back
// to this row regardless of whether it was learned from a live broadcast or
// from a fresh page load.
export const agentPendingToolCall = pgTable(
  "agent_pending_tool_call",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => agentChat.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<"pending" | "approved" | "rejected">()
      .notNull()
      .default("pending"),
    feedback: text("feedback"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("agent_pending_tool_call_chat_idx").on(t.chatId, t.status),
    index("agent_pending_tool_call_run_idx").on(t.runId, t.status),
  ],
)


