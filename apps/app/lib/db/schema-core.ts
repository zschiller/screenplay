import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import type { ModelMessage } from "ai"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import type { OrganizationState } from "@/lib/organization"

// The tables that survive into the local desktop build (PRD #404). The
// multi-user surface — auth (`session`/`account`/`verification`), `room_member`
// sharing, and `thread`/`comment`/`thread_read` — lives in `./schema-multiuser`
// and is excluded from the desktop build's PGlite migrations (`drizzle/local`).
// `./schema.ts` re-exports both halves, so the hosted build's full schema is
// unchanged. See `@/lib/local-mode`.

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

// Agent persistence — the ACP-native conversation log and run lifecycle the
// Engine seam drives (lib/agent/acp/, lib/agent/run-state.ts).

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
  (t) => [index("agent_chat_room_idx").on(t.roomId)]
)

// Append-only conversation log, one JSONB blob per message.
//
// The payload is moving from AI-SDK `ModelMessage` to the ACP-native
// `AcpMessageRecord` (ADR 0006): ACP is the canonical conversation
// representation, so the durable log speaks it too. Per the operator decision,
// existing rows are NOT converted — history is reset and new chats store
// ACP-native records going forward; the column union types both during the
// transition (jsonb, so no SQL migration). The `role` text discriminates them:
// ACP records use `"agent"`, legacy AI-SDK messages use `"assistant"`.
export const agentMessage = pgTable(
  "agent_message",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => agentChat.id, { onDelete: "cascade" }),
    role: text("role")
      .$type<ModelMessage["role"] | AcpMessageRecord["role"]>()
      .notNull(),
    message: jsonb("message")
      .$type<ModelMessage | AcpMessageRecord>()
      .notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("agent_message_chat_idx").on(t.chatId, t.createdAt)]
)

// Tracks a ToolLoopAgent invocation through its lifecycle. The run-state
// machine (lib/agent/run-state.ts) owns every transition; the loop polls its
// own status between steps via prepareStep and halts once it is no longer
// `running`. `endedAt` is stamped when the run reaches a terminal state.
export const agentRun = pgTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => agentChat.id, { onDelete: "cascade" }),
    // The truthful run states (#154): one enum where every terminal outcome is
    // its own value, so illegal combos are unrepresentable. `completed` = clean
    // finish, `failed` = threw, `aborted` = user /stop, `superseded` = replaced
    // by a later run. The enum is enforced only in TypeScript — `status` is a
    // plain `text` column — so narrowing it generates no SQL migration; the
    // legacy `ended` rows are backfilled and the `aborted` boolean dropped in
    // the contract migration (#170).
    status: text("status")
      .$type<
        | "running"
        | "paused_for_plan"
        | "completed"
        | "failed"
        | "aborted"
        | "superseded"
      >()
      .notNull()
      .default("running"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [index("agent_run_chat_idx").on(t.chatId, t.startedAt)]
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
  ]
)

// Persisted terminal tabs (#258). One row per open terminal tab, keyed by
// user + room + branch so the tab strip can restore a User's tabs on reload
// and follow them across devices. Terminal tabs are deliberately *not* part of
// the conversation model — this table holds only tab identity/metadata (id,
// label, ordering timestamp), never scrollback or any conversation content
// (per ADR 0002 and the dedicated `TerminalTabData` type from #256). Tabs are
// private to their owner (`user_id`), so they never surface in a collaborator's
// tab strip. The tab's `id` doubles as its shared live-view terminalSessionId
// on the client.
export const terminalTab = pgTable(
  "terminal_tab",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id, { onDelete: "cascade" }),
    // The Branch (agent) id whose sandbox this terminal runs against. A plain
    // text column — Branches live in the room's Y.Doc, not Postgres — so it is
    // intentionally not a foreign key.
    branch: text("branch").notNull(),
    label: text("label").notNull(),
    // The harness this tab launches into (`Harness.key`, e.g. "claude-code"),
    // resolved key → launch argv from the catalog at connect time rather than
    // storing the argv, so the launch command can change without rewriting
    // rows. Nullable: tabs created before harness auto-launch (#285), or whose
    // stored key is no longer installable, open a plain login shell.
    harnessKey: text("harness_key"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("terminal_tab_user_room_branch_idx").on(t.userId, t.roomId, t.branch),
  ]
)
