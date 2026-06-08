// Tool names are derived from the builders, not hand-maintained: each builder's
// return type is its `{ name: Tool }` map, so the keys *are* the tool names.
// Add a tool to a builder and it shows up here automatically; there's no second
// list to drift. These are `import type` only — erased at build, so this stays
// client-safe even though the builders are server-only.
import type { buildSandboxTools } from "@/lib/agent/tools"
import type { buildMarkdownLayerTools } from "@/lib/agent/markdown-layer-tools"
import type { buildLayerReadTools } from "@/lib/agent/layer-read-tools"
import type {
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from "@/lib/agent/acp/schema"

type AllTools = ReturnType<typeof buildSandboxTools> &
  ReturnType<typeof buildMarkdownLayerTools> &
  ReturnType<typeof buildLayerReadTools>

export type CustomToolName = keyof AllTools

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  // The agent's reasoning (ACP `agent_thought_chunk`), rendered in a collapsible
  // block distinct from the assistant message body so streamed thinking isn't
  // silently dropped.
  | { role: "reasoning"; content: string }
  | {
      role: "tool_use"
      name: CustomToolName
      input: Record<string, unknown>
    }
  | {
      role: "tool_result"
      name: CustomToolName
      output: string
    }
  | { role: "error"; content: string }
  | {
      role: "plan"
      content: string
      status: "pending" | "approved" | "rejected"
      planId: string
      /**
       * The human's rejection feedback, shown on a rejected plan card. Sent on
       * the `plan_rejected` event (and recovered from the pending row on reload)
       * — previously dropped, which is the "feedback never shown" gap #379 closes.
       */
      feedback?: string
    }
  // ACP-native tool call (issue #377), keyed by `toolCallId` and updated in
  // place through its status lifecycle. Unlike the legacy `tool_use`/
  // `tool_result` pair (matched by the parent at render time), this single row
  // carries the whole call — its status and its structured `content` blocks
  // (text, file `diff`, `terminal`) — so the renderer never re-pairs and never
  // flattens the richer output.
  | {
      role: "tool_call"
      toolCallId: string
      title: string
      kind?: ToolKind
      status: ToolCallStatus
      content: ToolCallContent[]
      rawInput?: Record<string, unknown>
    }
