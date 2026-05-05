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

export async function savePendingToolCall(params: {
  runId: string
  chatId: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}): Promise<string> {
  const id = nanoid()
  await db.insert(agentPendingToolCall).values({
    id,
    runId: params.runId,
    chatId: params.chatId,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    input: params.input,
  })
  return id
}

export async function findPendingToolCall(
  pendingId: string,
): Promise<{
  id: string
  runId: string
  chatId: string
  toolCallId: string
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
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    input: row.input,
    status: row.status,
  }
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
