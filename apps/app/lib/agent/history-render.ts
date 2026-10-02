import type { AgentMessage } from "@/lib/agent/types"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { blockText } from "@/lib/agent/acp/schema"
import { contentBlocksToWire } from "@/lib/agent/acp/markers"
import { userTurnMessage } from "@/lib/agent/user-turn"

/**
 * One entry in a chat's reload timeline (ADR 0006). Either an ACP-native
 * conversation `record` (`user`/`agent`/`thought`/`tool_call`) or a `plan`
 * gate reconstructed from its pending-tool-call row. The history route merges
 * the two streams by `createdAt` so a reload rebuilds the conversation in the
 * order it happened.
 */
export type HistoryEntry =
  | { kind: "record"; record: AcpMessageRecord }
  | {
      kind: "plan"
      planId: string
      plan: string
      status: "pending" | "approved" | "rejected"
    }
  // A run the user stopped, placed at the run's `endedAt`.
  | { kind: "stopped" }

/**
 * Render a chat's ACP-native timeline into the `AgentMessage[]` the chat UI
 * draws (ADR 0006). This is the reload counterpart of the live broadcast path:
 * the same four ACP record kinds the consumer persists and the chat-store
 * renders live, rebuilt from the durable log — so a reload reproduces the
 * conversation the live stream produced. The legacy `ModelMessage` conversion
 * switch is gone; only ACP-native records (plus plan gates) are rendered, and
 * legacy rows — which carry no ACP role — fall through unrendered (reset per
 * ADR 0006, not migrated).
 */
export function renderHistory(entries: HistoryEntry[]): AgentMessage[] {
  const out: AgentMessage[] = []
  for (const entry of entries) {
    if (entry.kind === "plan") {
      out.push({
        role: "plan",
        content: entry.plan,
        status: entry.status,
        planId: entry.planId,
      })
      continue
    }
    if (entry.kind === "stopped") {
      out.push({ role: "stopped" })
      continue
    }
    renderRecord(entry.record, out)
  }
  return out
}

function renderRecord(record: AcpMessageRecord, out: AgentMessage[]): void {
  switch (record.role) {
    case "user": {
      // The durable record stores the decorated wire text (markers + mention
      // `resource_link`s); recover the wire string losslessly, then project
      // it the way the live echo is, so a reload shows what the live chat did
      // (a wake stays hidden, a Delegated Message stays collapsed).
      const message = userTurnMessage(
        contentBlocksToWire(record.content),
        record.sentBy
      )
      if (message.content) out.push(message)
      break
    }
    case "agent": {
      const text = record.content.map(blockText).join("")
      if (text) out.push({ role: "assistant", content: text })
      break
    }
    case "thought": {
      const text = record.content.map(blockText).join("")
      if (text) out.push({ role: "reasoning", content: text })
      break
    }
    case "tool_call":
      out.push({
        role: "tool_call",
        toolCallId: record.toolCallId,
        title: record.title,
        kind: record.kind,
        status: record.status,
        content: record.content,
        rawInput: record.rawInput,
        parentToolCallId: record.parentToolCallId,
      })
      break
  }
}
