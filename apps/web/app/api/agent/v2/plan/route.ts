import { after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { db } from "@/lib/db"
import { agentChat } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import type { ToolContext } from "@/lib/agent/tool-executor"
import {
  buildPlanToolResultMessage,
  runAgentLoop,
} from "@/lib/agent/v2/engine"
import {
  appendMessage,
  findPendingToolCall,
  loadChatHistory,
  resolvePendingToolCall,
  startRun,
} from "@/lib/agent/v2/persistence"
import {
  broadcastEvent,
  broadcastSignal,
} from "@/lib/agent/v2/broadcast"

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

  await resolvePendingToolCall(planId, { approved, feedback })

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
  // valid tool-call → tool-result pair for submit_plan, then resume.
  const toolResultMsg = buildPlanToolResultMessage({
    toolCallId: pending.toolCallId,
    approved,
    feedback,
  })
  await appendMessage(chatId, toolResultMsg)

  const history = await loadChatHistory(chatId)
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

  after(async () => {
    await broadcastSignal(roomId, chatId, "chat-stream-start")
    await runAgentLoop({
      chatId,
      runId,
      roomId,
      systemPrompt: chat.systemPrompt,
      model: chat.model,
      toolCtx,
      messages: history,
    })
  })

  return Response.json({ success: true, runId })
}
