import type { AgentMessage } from "@/lib/agent/types"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { blockText } from "@/lib/agent/acp/schema"
import { contentBlocksToWire } from "@/lib/agent/acp/markers"
import { parseUserMessage } from "@/lib/agent/message-markers"

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
    renderRecord(entry.record, out)
  }
  return out
}

function renderRecord(record: AcpMessageRecord, out: AgentMessage[]): void {
  switch (record.role) {
    case "user": {
      // The durable record stores the decorated wire text (markers + mention
      // `resource_link`s); recover the wire string losslessly, then strip the
      // server prefixes so the UI shows the human's text — the one decoder for
      // this format. Inline `[@…](mention:…)` / `[skill: …]` tokens are retained
      // for the renderer's pills.
      const { body } = parseUserMessage(contentBlocksToWire(record.content))
      if (body) out.push({ role: "user", content: body })
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
      })
      break
  }
}
