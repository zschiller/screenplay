import "server-only"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "@/lib/db"
import {
  agentChat,
  agentMessage,
  agentPendingToolCall,
  agentRun,
} from "@/lib/db/schema"
import {
  repairOrphanedAcpToolCalls,
  type AcpMessageRecord,
  type AcpToolCallRecord,
} from "@/lib/agent/acp/record"

export async function upsertChat(params: {
  chatId: string
  roomId: string
  sandboxName: string
  model: string
  systemPrompt: string
}): Promise<void> {
  await db
    .insert(agentChat)
    .values({
      id: params.chatId,
      roomId: params.roomId,
      sandboxName: params.sandboxName,
      model: params.model,
      systemPrompt: params.systemPrompt,
    })
    .onConflictDoUpdate({
      target: agentChat.id,
      set: {
        sandboxName: params.sandboxName,
        model: params.model,
        systemPrompt: params.systemPrompt,
        updatedAt: new Date(),
      },
    })
}

/** The model a chat's last turn ran on, or `null` before its first turn. */
export async function getChatModel(chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ model: agentChat.model })
    .from(agentChat)
    .where(eq(agentChat.id, chatId))
    .limit(1)
  return row?.model || null
}

/**
 * The external engine's stored native ACP session id for a chat, or `null` if
 * none is bound yet (no external turn has run, or the chat is in-process). Read
 * at the live-route boundary to decide whether a turn resumes the agent's own
 * session via `session/load` or boots a fresh `session/new`.
 */
export async function getAcpSessionId(
  chatId: string
): Promise<string | null> {
  const [row] = await db
    .select({ acpSessionId: agentChat.acpSessionId })
    .from(agentChat)
    .where(eq(agentChat.id, chatId))
    .limit(1)
  return row?.acpSessionId ?? null
}

/**
 * Persist the native ACP session id the external engine bound this turn, so the
 * next turn resumes it. Called only when a fresh `session/new` is created — a
 * successful `session/load` reuses the same id, so there is nothing to write.
 */
export async function setAcpSessionId(
  chatId: string,
  acpSessionId: string
): Promise<void> {
  await db
    .update(agentChat)
    .set({ acpSessionId, updatedAt: new Date() })
    .where(eq(agentChat.id, chatId))
}

/**
 * Reconcile the chat's stored `model` id after a session-open silent fallback
 * (#526). When the chat's stored model is no longer offered by the live Harness
 * (e.g. the subscription tier changed), the session falls back to the Harness
 * default and calls this to rewrite the stored id to the resolved one, so the
 * next open is clean rather than re-tripping the same stale lookup. A model is a
 * preference refinement, not an identity — so this corrects silently, unlike a
 * missing Harness, which fails loud.
 */
export async function setChatModel(
  chatId: string,
  model: string
): Promise<void> {
  await db
    .update(agentChat)
    .set({ model, updatedAt: new Date() })
    .where(eq(agentChat.id, chatId))
}

/**
 * Append one ACP-native message record to the durable log (ADR 0006). The
 * ACP-update consumer calls this for every agent/reasoning turn, and the routes
 * call it to land the incoming user turn before the engine runs.
 */
export async function appendAcpMessage(
  chatId: string,
  record: AcpMessageRecord
): Promise<void> {
  await db.insert(agentMessage).values({
    id: nanoid(),
    chatId,
    role: record.role,
    message: record,
  })
}

/**
 * The `agent_message` row id one ACP tool call owns. Scoped to the **run**, not
 * just the chat (#742): provider tool-call ids are only guaranteed unique
 * within the turn that issued them, and OpenAI-compatible servers that number
 * calls per response (`call_1`, `call_2`, … restarting every turn) reuse them
 * across turns. Keying by chat alone let a later turn's call overwrite an
 * earlier turn's row; keying by run cannot, because a run never spans turns.
 *
 * Nothing outside this module parses the id — it is an opaque text primary key
 * — so pre-existing rows keep their older chat-scoped ids and simply stop
 * colliding with new ones.
 */
function acpToolCallRowId(
  chatId: string,
  runId: string,
  toolCallId: string
): string {
  return `tc_${chatId}_${runId}_${toolCallId}`
}

/**
 * Upsert an ACP-native tool-call record *in place* by `toolCallId` (ADR 0006,
 * issue #377). The row id is derived from the chat + run + tool-call id, so
 * every `pending` → `in_progress` → `completed`/`failed` update *of the same
 * call* rewrites the same row — and `createdAt` keeps its first-insert value,
 * so the call holds its position in the conversation order regardless of how
 * many times it updates. Two runs that happen to reuse a provider's tool-call
 * id get two rows, not one (see {@link acpToolCallRowId}); the consumer is
 * built per run, so a single call's updates all land under one run id.
 */
export async function upsertAcpToolCall(
  chatId: string,
  runId: string,
  record: AcpToolCallRecord
): Promise<void> {
  await db
    .insert(agentMessage)
    .values({
      id: acpToolCallRowId(chatId, runId, record.toolCallId),
      chatId,
      role: record.role,
      message: record,
    })
    .onConflictDoUpdate({
      target: agentMessage.id,
      set: { message: record },
    })
}

/**
 * Load a chat's ACP-native history (ADR 0006), oldest first — the input the
 * in-process engine rebuilds its `ModelMessage[]` from at turn start. Reads the
 * rows the {@link appendAcpMessage} writer produced (roles `"user"`/`"agent"`).
 */
export async function loadAcpHistory(
  chatId: string
): Promise<AcpMessageRecord[]> {
  const rows = await db
    .select({ message: agentMessage.message })
    .from(agentMessage)
    .where(eq(agentMessage.chatId, chatId))
    .orderBy(asc(agentMessage.createdAt))
  return rows.map((r) => r.message as AcpMessageRecord)
}

/**
 * Same as {@link loadAcpHistory}, but repairs any tool call a crash mid-turn
 * left frozen in a non-terminal status (PRD #375, issue #382) — the ACP-native
 * counterpart of {@link loadChatHistoryForModel}. Use this anywhere the
 * ACP-native history is about to drive a model turn, so an orphaned tool call
 * never reaches the provider as an unresolved call. The UI history route reads
 * {@link loadAcpHistory} directly, where a still-`in_progress` call renders
 * honestly as in-flight rather than synthetically failed.
 */
export async function loadAcpHistoryForModel(
  chatId: string
): Promise<AcpMessageRecord[]> {
  return repairOrphanedAcpToolCalls(await loadAcpHistory(chatId))
}

/**
 * Most recent run for a chat that is still active — i.e. `running` or
 * `paused_for_plan`. Used by /stop to find what to abort and by /heal to know
 * whether the chat is still doing something. Run lifecycle transitions
 * themselves go through the run-state machine (`run-state.ts`); this is a
 * read-only lookup.
 */
export async function findActiveRun(
  chatId: string
): Promise<{ id: string; status: "running" | "paused_for_plan" } | null> {
  const [row] = await db
    .select({ id: agentRun.id, status: agentRun.status })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.chatId, chatId),
        inArray(agentRun.status, ["running", "paused_for_plan"])
      )
    )
    .orderBy(desc(agentRun.startedAt))
    .limit(1)
  if (!row) return null
  return { id: row.id, status: row.status as "running" | "paused_for_plan" }
}

export async function findPendingToolCall(pendingId: string): Promise<{
  id: string
  runId: string
  chatId: string
  toolName: string
  input: Record<string, unknown>
  status: "pending" | "approved" | "rejected"
} | null> {
  const [row] = await db
    .select()
    .from(agentPendingToolCall)
    .where(eq(agentPendingToolCall.id, pendingId))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    runId: row.runId,
    chatId: row.chatId,
    toolName: row.toolName,
    input: row.input,
    status: row.status,
  }
}

/**
 * Find the most recent pending submit_plan for a chat. Used by the stream
 * route to detect a follow-up message arriving while a plan is awaiting
 * approval — the new message is treated as an implicit rejection.
 */
export async function findPendingPlanForChat(chatId: string): Promise<{
  id: string
  input: Record<string, unknown>
} | null> {
  const [row] = await db
    .select({
      id: agentPendingToolCall.id,
      input: agentPendingToolCall.input,
    })
    .from(agentPendingToolCall)
    .where(
      and(
        eq(agentPendingToolCall.chatId, chatId),
        eq(agentPendingToolCall.toolName, "submit_plan"),
        eq(agentPendingToolCall.status, "pending")
      )
    )
    .orderBy(desc(agentPendingToolCall.createdAt))
    .limit(1)
  return row ?? null
}
