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
  settleWorkspacePlan,
} from "@/lib/agent/turn-launch-live"
import { isWorkspacePlanInput } from "@/lib/agent/room-tools"
import { workspacePlanResolutionText } from "@/lib/agent/workspace-task"

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
  // A `create_workspaces` plan (#898) comes from the Coordinator: it resumes
  // with the Coordinator's own tools, and approving it creates exactly the
  // Workspaces the plan showed.
  const workspacePlan = isWorkspacePlanInput(pending.input)
    ? pending.input
    : null
  const message = workspacePlan
    ? workspacePlanResolutionText({ approved, feedback })
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
    workspacePlan
      ? roomTurn({ room, chatId, message, model: chat.model })
      : planResumeTurn({ room, userId, message, chat })
  )
  // Nothing was still pending: a double-submit, or a gate a /stop or a
  // follow-up message already resolved.
  if (result.kind !== "started") {
    return new Response("Plan already resolved", { status: 409 })
  }
  // Before the response: the resumed turn runs after it, and reads the
  // outcome this records.
  if (workspacePlan) {
    await settleWorkspacePlan(room, {
      chatId,
      runId: result.runId,
      planId,
      plan: workspacePlan,
      approved,
      feedback,
    })
  }
  return Response.json({ success: true, runId: result.runId })
}
