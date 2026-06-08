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
 * Upsert an ACP-native tool-call record *in place* by `toolCallId` (ADR 0006,
 * issue #377). The row id is derived from the chat + tool-call id, so every
 * `pending` → `in_progress` → `completed`/`failed` update rewrites the same
 * row — and `createdAt` keeps its first-insert value, so the call holds its
 * position in the conversation order regardless of how many times it updates.
 */
export async function upsertAcpToolCall(
  chatId: string,
  record: AcpToolCallRecord
): Promise<void> {
  await db
    .insert(agentMessage)
    .values({
      id: `tc_${chatId}_${record.toolCallId}`,
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
