import { and, asc, eq, isNotNull } from "drizzle-orm"
import { getUserId } from "@/lib/auth-helpers"
import { chatRoomId, openRoomForRoute } from "@/lib/room-access"
import { db } from "@/lib/db"
import { agentMessage, agentPendingToolCall, agentRun } from "@/lib/db/schema"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { renderHistory, type HistoryEntry } from "@/lib/agent/history-render"

export const runtime = "nodejs"

/**
 * Reload a chat from its ACP-native durable log (ADR 0006). The four ACP record
 * kinds (`user`/`agent`/`thought`/`tool_call`) are merged with the chat's plan
 * gates — reconstructed from their `submit_plan` pending-tool-call rows — by
 * `createdAt`, so a reload rebuilds the same conversation the live broadcast
 * produced. The legacy `ModelMessage` conversion switch is gone; legacy rows
 * carry no ACP role and render as nothing (reset per ADR 0006, not migrated).
 */
export async function GET(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const { searchParams } = new URL(req.url)
  const chatId = searchParams.get("chatId")
  if (!chatId) return Response.json([])

  // The chat's own Room decides who may read it. A chat no turn has recorded
  // yet has no history to read.
  const roomId = await chatRoomId(chatId)
  if (!roomId) return Response.json([])
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const [rows, planRows, stoppedRuns] = await Promise.all([
    db
      .select({
        message: agentMessage.message,
        createdAt: agentMessage.createdAt,
      })
      .from(agentMessage)
      .where(eq(agentMessage.chatId, chatId))
      .orderBy(asc(agentMessage.createdAt)),
    // The pending-tool-call row id IS the tool-call id, so it lines up directly
    // with the planId the client holds; its status drives the card's resolved
    // state on reload.
    db
      .select({
        id: agentPendingToolCall.id,
        input: agentPendingToolCall.input,
        status: agentPendingToolCall.status,
        createdAt: agentPendingToolCall.createdAt,
      })
      .from(agentPendingToolCall)
      .where(
        and(
          eq(agentPendingToolCall.chatId, chatId),
          eq(agentPendingToolCall.toolName, "submit_plan")
        )
      ),
    // Runs the user stopped. The stop drops the run's remaining output, so
    // nothing in the message log says the turn was cut short; its `endedAt`
    // places a "Stopped" marker where the transcript ends.
    db
      .select({ endedAt: agentRun.endedAt })
      .from(agentRun)
      .where(
        and(
          eq(agentRun.chatId, chatId),
          eq(agentRun.status, "aborted"),
          isNotNull(agentRun.endedAt)
        )
      ),
  ])

  // Merge the streams into one time-ordered timeline so the plan card lands
  // between the narration that preceded it and the resolution that followed.
  const timeline: Array<{ createdAt: Date; entry: HistoryEntry }> = []
  for (const r of rows) {
    timeline.push({
      createdAt: r.createdAt,
      entry: { kind: "record", record: r.message as AcpMessageRecord },
    })
  }
  for (const p of planRows) {
    timeline.push({
      createdAt: p.createdAt,
      entry: {
        kind: "plan",
        planId: p.id,
        plan: String((p.input as { plan?: unknown }).plan ?? ""),
        status: p.status,
      },
    })
  }
  for (const r of stoppedRuns) {
    if (r.endedAt)
      timeline.push({ createdAt: r.endedAt, entry: { kind: "stopped" } })
  }
  timeline.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return Response.json(renderHistory(timeline.map((t) => t.entry)))
}
