import type { ModelMessage } from "ai"
import { and, eq } from "drizzle-orm"
import { getUserId } from "@/lib/auth-helpers"
import { db } from "@/lib/db"
import { agentPendingToolCall } from "@/lib/db/schema"
import type { AgentMessage, CustomToolName } from "@/lib/agent/types"
import { loadChatHistory } from "@/lib/agent/v2/persistence"

export const runtime = "nodejs"

/**
 * Convert stored ModelMessages back to the v1 `AgentMessage[]` shape so
 * existing chat UI renders v2 chats without changes.
 *
 * `submit_plan` calls are surfaced as `role: "plan"` rows so the UI can render
 * them as plan cards. Status comes from the `agent_pending_tool_call` table
 * (pending if no row, otherwise approved/rejected).
 */
export async function GET(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const { searchParams } = new URL(req.url)
  const chatId = searchParams.get("chatId")
  if (!chatId) return Response.json([])

  const [history, planRows] = await Promise.all([
    loadChatHistory(chatId),
    db
      .select({
        toolCallId: agentPendingToolCall.toolCallId,
        status: agentPendingToolCall.status,
      })
      .from(agentPendingToolCall)
      .where(
        and(
          eq(agentPendingToolCall.chatId, chatId),
          eq(agentPendingToolCall.toolName, "submit_plan"),
        ),
      ),
  ])

  const planStatusByToolCallId = new Map<
    string,
    "pending" | "approved" | "rejected"
  >()
  for (const r of planRows) {
    planStatusByToolCallId.set(r.toolCallId, r.status)
  }

  const messages: AgentMessage[] = []
  for (const m of history) {
    convertMessage(m, planStatusByToolCallId, messages)
  }

  return Response.json(messages)
}

function convertMessage(
  m: ModelMessage,
  planStatuses: Map<string, "pending" | "approved" | "rejected">,
  out: AgentMessage[],
): void {
  switch (m.role) {
    case "user": {
      const text = stringifyContent(m.content)
      // Strip the [plan mode: enabled] / [branch: ...] prefixes the stream
      // route prepends — they're routing metadata for the model, not for the
      // UI.
      const cleaned = text
        .replace(/^\[plan mode: enabled\]\s*/, "")
        .replace(/^\[branch: [^\]]+\]\s*/, "")
      if (cleaned) out.push({ role: "user", content: cleaned })
      break
    }

    case "assistant": {
      if (typeof m.content === "string") {
        if (m.content) out.push({ role: "assistant", content: m.content })
        return
      }
      // Multi-part assistant: text parts → assistant messages, tool-call parts
      // → tool_use rows (with submit_plan special-cased to plan rows).
      for (const part of m.content) {
        if (part.type === "text" && part.text) {
          out.push({ role: "assistant", content: part.text })
        } else if (part.type === "tool-call") {
          if (part.toolName === "submit_plan") {
            const plan = (part.input as { plan?: string })?.plan ?? ""
            out.push({
              role: "plan",
              content: plan,
              status: planStatuses.get(part.toolCallId) ?? "pending",
              planId: part.toolCallId,
            })
          } else {
            out.push({
              role: "tool_use",
              name: part.toolName as CustomToolName,
              input: (part.input as Record<string, unknown>) ?? {},
            })
          }
        }
      }
      break
    }

    case "tool": {
      if (typeof m.content === "string") return
      for (const part of m.content) {
        if (part.type !== "tool-result") continue
        // Hide the synthetic submit_plan resolution — the plan card already
        // shows its own approved/rejected state.
        if (part.toolName === "submit_plan") continue
        const output = extractToolResultText(part.output)
        out.push({
          role: "tool_result",
          name: part.toolName as CustomToolName,
          output,
        })
      }
      break
    }

    case "system":
      // System messages don't surface to the chat UI.
      break
  }
}

function stringifyContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content
  let s = ""
  for (const part of content) {
    if ("text" in part && typeof part.text === "string") s += part.text
  }
  return s
}

function extractToolResultText(output: unknown): string {
  if (typeof output === "string") return output
  if (output && typeof output === "object") {
    const o = output as { type?: string; value?: unknown; text?: string }
    if (o.type === "text" && typeof o.value === "string") return o.value
    if (typeof o.text === "string") return o.text
    return JSON.stringify(output)
  }
  return String(output)
}
