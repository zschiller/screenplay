import "server-only"

import type { ModelMessage } from "ai"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
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

/**
 * Same as `loadChatHistory`, but synthesises tool-result messages for any
 * `tool_use` parts that have no matching `tool_result` further along — the
 * shape every provider requires before a follow-up turn.
 *
 * Orphans happen when a run is aborted (or crashes) between the assistant
 * emitting a tool call and the matching result being persisted: /stop fires
 * during tool execution, the route's `after()` callback dies, etc. Without
 * this repair, the next turn sends a malformed history and the provider
 * rejects with "Tool results are missing for tool calls toolu_…".
 *
 * The synthetic result is NOT persisted — repairing on every load keeps DB
 * timestamps clean (a backdated insert would land after newer messages) and
 * stays idempotent for whatever future bug also leaves an orphan.
 *
 * Use this anywhere the history is about to be handed to a model. The UI
 * history route still calls `loadChatHistory` directly; orphans there render
 * as bare tool_use rows, which is the honest representation.
 */
export async function loadChatHistoryForModel(
  chatId: string,
): Promise<ModelMessage[]> {
  return repairOrphanedToolCalls(await loadChatHistory(chatId))
}

/**
 * Walk the history and reshape each `assistant (with tool_use parts) → tool`
 * boundary into a single, well-formed pair:
 *
 *   - For each assistant message containing tool_use parts, emit exactly one
 *     following tool message whose content is every tool_use's matching
 *     tool_result. Missing results are filled in with a synthetic
 *     "interrupted" payload; stale results whose toolCallId doesn't appear
 *     in this assistant message are dropped.
 *   - Consecutive raw tool messages are merged into that single message —
 *     some providers (incl. @ai-sdk/anthropic in some shapes) emit a separate
 *     user message per tool ModelMessage, which Anthropic rejects with
 *     "Each `tool_result` block must have a corresponding `tool_use` block
 *     in the previous message."
 *   - Stray tool messages that don't follow an assistant-with-tools at all
 *     are dropped — they'd surface as an orphan tool_result and trip the
 *     same Anthropic check.
 *
 * Pure / idempotent — safe to call on already-clean histories.
 */
export function repairOrphanedToolCalls(
  messages: ModelMessage[],
): ModelMessage[] {
  const out: ModelMessage[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]!

    // Orphan tool message: no preceding assistant tool_use to attach to.
    if (msg.role === "tool") {
      i++
      continue
    }

    if (msg.role !== "assistant" || typeof msg.content === "string") {
      out.push(msg)
      i++
      continue
    }

    const toolCalls = msg.content.filter(
      (p): p is Extract<typeof p, { type: "tool-call" }> =>
        p.type === "tool-call",
    )

    out.push(msg)
    i++

    if (toolCalls.length === 0) continue

    const validIds = new Set(toolCalls.map((p) => p.toolCallId))
    const existing: Extract<
      Extract<ModelMessage, { role: "tool" }>["content"],
      readonly unknown[]
    > = []
    const resolved = new Set<string>()

    while (i < messages.length && messages[i]!.role === "tool") {
      const next = messages[i]!
      if (typeof next.content !== "string") {
        for (const part of next.content) {
          if (part.type !== "tool-result") continue
          // Drop stale results — keeping them would leave a tool_result in
          // the merged tool message with no matching tool_use above.
          if (!validIds.has(part.toolCallId)) continue
          if (resolved.has(part.toolCallId)) continue
          existing.push(part)
          resolved.add(part.toolCallId)
        }
      }
      i++
    }

    const synthetic = toolCalls
      .filter((p) => !resolved.has(p.toolCallId))
      .map((p) => ({
        type: "tool-result" as const,
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        output: {
          type: "text" as const,
          value: "Tool execution was interrupted.",
        },
      }))

    out.push({
      role: "tool",
      content: [...existing, ...synthetic],
    })
  }
  return out
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

/**
 * Most recent run for a chat that is still active — i.e. `running` or
 * `paused_for_plan`. Used by /stop to find what to abort and by /heal to know
 * whether the chat is still doing something. Run lifecycle transitions
 * themselves go through the run-state machine (`run-state.ts`); this is a
 * read-only lookup.
 */
export async function findActiveRun(
  chatId: string,
): Promise<{ id: string; status: "running" | "paused_for_plan" } | null> {
  const [row] = await db
    .select({ id: agentRun.id, status: agentRun.status })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.chatId, chatId),
        inArray(agentRun.status, ["running", "paused_for_plan"]),
      ),
    )
    .orderBy(desc(agentRun.startedAt))
    .limit(1)
  if (!row) return null
  return { id: row.id, status: row.status as "running" | "paused_for_plan" }
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
