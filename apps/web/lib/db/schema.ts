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
    // Coordinates are canvas-space (or artboard-space when artboardId is set).
    // When a selector is set, x/y is the last known resolved position used as
    // a fallback if the selector no longer matches an element.
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    artboardId: text("artboard_id"),
    // CSS path to the iframe DOM element the comment is anchored to (artboard
    // comments only). offset_x/y are stored as fractions of the element's
    // width/height (0–1) at click time, so the pin tracks the same relative
    // point on the element as the layout reflows or resizes.
    selector: text("selector"),
    offsetX: doublePrecision("offset_x"),
    offsetY: doublePrecision("offset_y"),
    resolved: boolean("resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("thread_room_idx").on(t.roomId)],
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

