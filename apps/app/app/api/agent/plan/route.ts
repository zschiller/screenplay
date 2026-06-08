import { after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { db } from "@/lib/db"
import { agentChat } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { toolsetFor } from "@/lib/agent/toolset"
import type { ToolContext } from "@/lib/agent/tools"
import { findPendingToolCall } from "@/lib/agent/persistence"
import { startRun } from "@/lib/agent/run-state"
import { broadcastSignal } from "@/lib/agent/broadcast"
import { resolvePlanGate } from "@/lib/agent/acp/resolution"
import { livePlanResolutionPorts } from "@/lib/agent/acp/consumer-live"
import { selectEngine } from "@/lib/agent/acp/engine-select"
import { launchEngineTurn } from "@/lib/agent/launch-turn"

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

  // Resolve the engine up front so a misconfigured deployment fails loud here
  // rather than silently falling back (ADR 0006).
  const engine = selectEngine()

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

  // Resolve the plan gate, ACP-native (ADR 0006): supersede the paused run,
  // persist the human resolution as an ACP-native `user` record (the
  // continuation the agent acts on next — approve → "proceed", reject → the
  // feedback), and broadcast the outcome (flip the plan card + echo the
  // continuation as a live user turn). Returns null when nothing was still
  // pending (a double-submit or a gate a /stop already tore down).
  const resolved = await resolvePlanGate(
    livePlanResolutionPorts(roomId, chatId),
    planId,
    { approved, feedback }
  )
  if (!resolved) return new Response("Plan already resolved", { status: 409 })

  // Look up the chat's recorded model + system prompt so the resume uses the
  // same agent configuration as the original run.
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

  const runId = await startRun(chatId)

  // Re-enter the streaming state before the response returns; a failed `after()`
  // won't leave the chat stuck on the plan card with no progress.
  await broadcastSignal(roomId, chatId, "chat-stream-start")

  after(() =>
    launchEngineTurn({
      engine,
      roomId,
      chatId,
      runId,
      systemPrompt: chat.systemPrompt,
      model: chat.model,
      tools: toolsetFor({ kind: "sandbox", roomId, sandbox: toolCtx }),
    })
  )

  return Response.json({ success: true, runId })
}
