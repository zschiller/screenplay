import { openRoomForRoute } from "@/lib/room-access"
import { db } from "@/lib/db"
import { agentChat } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { findPendingToolCall } from "@/lib/agent/persistence"
import { planResolutionText } from "@/lib/agent/acp/resolution"
import { launchTurn } from "@/lib/agent/turn-launch"
import {
  liveTurnLaunchDeps,
  planResumeTurn,
  roomTurn,
} from "@/lib/agent/turn-launch-live"

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
  const body: RequestBody = await req.json()
  const { roomId, chatId, planId, approved, feedback } = body
  if (!roomId || !chatId || !planId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const room = await openRoomForRoute(roomId, chatId)
  if (room instanceof Response) return room
  const { userId } = room

  const pending = await findPendingToolCall(planId)
  if (!pending) return new Response("Plan not found", { status: 404 })
  if (pending.status !== "pending") {
    return new Response("Plan already resolved", { status: 409 })
  }
  if (pending.chatId !== chatId) {
    return new Response("Plan/chat mismatch", { status: 400 })
  }

  // Look up the chat's recorded config (model, system prompt, sandbox) — the
  // resume reuses the original run's agent configuration, and the external
  // engine needs the Branch's worktree (`sandboxName`) to spawn its adapter.
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

  // Turn Launch resolves the plan (the one path shared with a follow-up
  // message's implicit rejection) and resumes the chat with the decision's
  // continuation as the next user turn: approve → "proceed", reject → the
  // feedback.
  //
  // A Coordinator card left pending from before its actions stopped asking
  // (#1217) resumes the Coordinator with the answer and its own tools; it
  // does nothing itself, and on a yes the Coordinator calls the tool again.
  const coordinatorCard = typeof pending.input?.gate === "string"
  const message = coordinatorCard
    ? coordinatorCardAnswer({ approved, feedback })
    : planResolutionText({ approved, feedback })
  const result = await launchTurn(
    liveTurnLaunchDeps(room),
    {
      roomId,
      chatId,
      message,
      sandboxName: chat.sandboxName,
      model: chat.model,
      planDecision: { planId, approved, feedback },
    },
    coordinatorCard
      ? roomTurn({ room, chatId, message, model: chat.model })
      : planResumeTurn({ room, chatId, userId, message, chat })
  )
  // Nothing was still pending: a double-submit, or a gate a /stop or a
  // follow-up message already resolved.
  if (result.kind !== "started") {
    return new Response("Plan already resolved", { status: 409 })
  }
  return Response.json({ success: true, runId: result.runId })
}

/** The user's answer to a pending Coordinator card, as their next message. */
function coordinatorCardAnswer(resolution: {
  approved: boolean
  feedback?: string
}): string {
  return resolution.approved
    ? "Yes, go ahead."
    : resolution.feedback?.trim() || "No, leave it."
}
