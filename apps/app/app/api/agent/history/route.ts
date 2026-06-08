import { and, asc, eq } from "drizzle-orm"
import { getUserId } from "@/lib/auth-helpers"
import { db } from "@/lib/db"
import { agentMessage, agentPendingToolCall } from "@/lib/db/schema"
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

  const [rows, planRows] = await Promise.all([
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
  ])

  // Merge the two streams into one time-ordered timeline so the plan card lands
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
  timeline.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return Response.json(renderHistory(timeline.map((t) => t.entry)))
}
