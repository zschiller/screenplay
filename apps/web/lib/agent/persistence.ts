import "server-only"

import type { ModelMessage } from "ai"
import { and, asc, desc, eq, ne } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "@/lib/db"
import {
  agentChat,
  agentMessage,
  agentPendingToolCall,
  agentRun,
} from "@/lib/db/schema"

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

export async function loadChatHistory(chatId: string): Promise<ModelMessage[]> {
  const rows = await db
    .select({ message: agentMessage.message })
    .from(agentMessage)
    .where(eq(agentMessage.chatId, chatId))
    .orderBy(asc(agentMessage.createdAt))
  return rows.map((r) => r.message)
}

export async function appendMessage(
  chatId: string,
  message: ModelMessage,
): Promise<void> {
  await db.insert(agentMessage).values({
    id: nanoid(),
    chatId,
    role: message.role,
    message,
  })
}

export async function appendMessages(
  chatId: string,
  messages: ModelMessage[],
): Promise<void> {
  if (messages.length === 0) return
  await db.insert(agentMessage).values(
    messages.map((message) => ({
      id: nanoid(),
      chatId,
      role: message.role,
      message,
    })),
  )
}

export async function startRun(chatId: string): Promise<string> {
  // Abort any still-active runs for this chat before inserting the new one.
  // Without this, a user who clicks Stop and immediately resends a message
  // would have the old loop still emitting chunks while the new loop runs,
  // and `findActiveRun` would return whichever was inserted most recently,
  // letting /stop target the wrong run.
  await db
    .update(agentRun)
    .set({ aborted: true, status: "ended", endedAt: new Date() })
    .where(and(eq(agentRun.chatId, chatId), ne(agentRun.status, "ended")))
  const id = nanoid()
  await db.insert(agentRun).values({ id, chatId, status: "running" })
  return id
}

export async function isRunAborted(runId: string): Promise<boolean> {
  const [row] = await db
    .select({ aborted: agentRun.aborted })
    .from(agentRun)
    .where(eq(agentRun.id, runId))
    .limit(1)
  return row?.aborted ?? false
}

export async function abortRun(runId: string): Promise<void> {
  await db
    .update(agentRun)
    .set({ aborted: true, status: "ended", endedAt: new Date() })
    .where(eq(agentRun.id, runId))
}

export async function endRun(
  runId: string,
  status: "ended" | "paused_for_plan" = "ended",
): Promise<void> {
  await db
    .update(agentRun)
    .set({
      status,
      ...(status === "ended" ? { endedAt: new Date() } : {}),
    })
    .where(eq(agentRun.id, runId))
}

/**
 * Most recent run for a chat that hasn't ended yet — i.e. running or paused
 * for plan approval. Used by /stop to find what to abort and by /plan to
 * know which loop to resume.
 */
export async function findActiveRun(
  chatId: string,
): Promise<{ id: string; status: "running" | "paused_for_plan" } | null> {
  const [row] = await db
    .select({ id: agentRun.id, status: agentRun.status })
    .from(agentRun)
    .where(and(eq(agentRun.chatId, chatId), ne(agentRun.status, "ended")))
    .orderBy(desc(agentRun.startedAt))
    .limit(1)
  if (!row) return null
  return { id: row.id, status: row.status as "running" | "paused_for_plan" }
}

/**
 * Persist a tool call that's waiting on a human decision. The row's primary
 * key IS the AI SDK tool-call id — same value used for the `plan_submitted`
 * broadcast and the history-route reconstruction, so the client's planId
 * always resolves back to this row.
 */
export async function savePendingToolCall(params: {
  runId: string
  chatId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}): Promise<string> {
  await db.insert(agentPendingToolCall).values({
    id: params.toolCallId,
    runId: params.runId,
    chatId: params.chatId,
    toolName: params.toolName,
    input: params.input,
  })
  return params.toolCallId
}

export async function findPendingToolCall(
  pendingId: string,
): Promise<{
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
        eq(agentPendingToolCall.status, "pending"),
      ),
    )
    .orderBy(desc(agentPendingToolCall.createdAt))
    .limit(1)
  return row ?? null
}

export async function resolvePendingToolCall(
  pendingId: string,
  resolution: { approved: boolean; feedback?: string },
): Promise<void> {
  await db
    .update(agentPendingToolCall)
    .set({
      status: resolution.approved ? "approved" : "rejected",
      feedback: resolution.feedback ?? null,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(agentPendingToolCall.id, pendingId),
        eq(agentPendingToolCall.status, "pending"),
      ),
    )
}
