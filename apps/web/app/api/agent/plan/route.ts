import { after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { db } from "@/lib/db"
import { agentChat } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { toolsetFor } from "@/lib/agent/toolset"
import type { ToolContext } from "@/lib/agent/tools"
import { buildPlanToolResultMessage, runAgentLoop } from "@/lib/agent/engine"
import {
  appendMessage,
  findPendingToolCall,
  loadChatHistoryForModel,
} from "@/lib/agent/persistence"
import { resolvePlan, startRun, transition } from "@/lib/agent/run-state"
import { broadcastEvent, broadcastSignal } from "@/lib/agent/broadcast"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  planId: string
  approved: boolean
  feedback?: string
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body: RequestBody = await req.json()
  const { roomId, chatId, planId, approved, feedback } = body
  if (!roomId || !chatId || !planId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const pending = await findPendingToolCall(planId)
  if (!pending) return new Response("Plan not found", { status: 404 })
  if (pending.status !== "pending") {
    return new Response("Plan already resolved", { status: 409 })
  }
  if (pending.chatId !== chatId) {
    return new Response("Plan/chat mismatch", { status: 400 })
  }

  // Resolve the plan and supersede its run atomically: the tool-call is marked
  // approved/rejected and the paused run moves to `superseded` in one
  // transaction. Starting the continuation is a separate `startRun` below.
  await resolvePlan(planId, { approved, feedback })

  // Look up the chat's recorded model + system prompt so the resume call uses
  // the same agent configuration as the original run.
  const [chat] = await db
    .select({
      sandboxName: agentChat.sandboxName,
      model: agentChat.model,
      systemPrompt: agentChat.systemPrompt,
    })
    .from(agentChat)
    .where(eq(agentChat.id, chatId))
    .limit(1)
  if (!chat) return new Response("Chat not found", { status: 404 })

  const toolCtx: ToolContext = {
    sandboxName: chat.sandboxName,
    roomId,
    userId,
  }

  // Append the human-side resolution as a tool message so the model sees a
  // valid tool-call → tool-result pair for submit_plan, then resume. The
  // row id IS the tool-call id, so `pending.id` is what the AI SDK is
  // expecting in the tool-result.
  const toolResultMsg = buildPlanToolResultMessage({
    toolCallId: pending.id,
    approved,
    feedback,
  })
  await appendMessage(chatId, toolResultMsg)

  const history = await loadChatHistoryForModel(chatId)
  const runId = await startRun(chatId)

  // Mirror v1's approval/rejection broadcast so the UI updates the plan card.
  if (approved) {
    await broadcastEvent(roomId, chatId, { type: "plan_approved", planId })
  } else {
    await broadcastEvent(roomId, chatId, {
      type: "plan_rejected",
      planId,
      feedback: feedback ?? "No feedback provided",
    })
  }

  // Broadcast the resume signal synchronously so the UI re-enters the
  // streaming state before the response returns; a failed `after()` won't
  // leave the chat stuck on the plan card with no progress.
  await broadcastSignal(roomId, chatId, "chat-stream-start")

  after(async () => {
    try {
      await runAgentLoop({
        chatId,
        runId,
        roomId,
        systemPrompt: chat.systemPrompt,
        model: chat.model,
        tools: toolsetFor({ kind: "sandbox", roomId, sandbox: toolCtx }),
        messages: history,
      })
    } catch (e) {
      console.error("runAgentLoop failed (plan resume):", e)
      const msg = e instanceof Error ? e.message : String(e)
      try {
        await broadcastEvent(roomId, chatId, { type: "error", message: msg })
      } finally {
        await transition(runId, "failed").catch(() => {})
        await broadcastSignal(roomId, chatId, "chat-stream-end")
      }
    }
  })

  return Response.json({ success: true, runId })
}
