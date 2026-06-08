// Tool names are derived from the builders, not hand-maintained: each builder's
// return type is its `{ name: Tool }` map, so the keys *are* the tool names.
// Add a tool to a builder and it shows up here automatically; there's no second
// list to drift. These are `import type` only — erased at build, so this stays
// client-safe even though the builders are server-only.
import type { buildSandboxTools } from "@/lib/agent/tools"
import type { buildMarkdownLayerTools } from "@/lib/agent/markdown-layer-tools"
import type { buildLayerReadTools } from "@/lib/agent/layer-read-tools"

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

export type AgentStreamEvent =
  // `textId` identifies the source text block from the model. The client
  // tracks the most recent textId per chat and appends a new assistant
  // message whenever it changes, so multiple text blocks within a step
  // don't clobber each other in the UI.
  | { type: "user_message"; text: string }
  | { type: "text"; text: string; textId?: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string }
  | { type: "status"; status: string }
  | { type: "error"; message: string }
  | { type: "branch_rename"; branch: string }
  | { type: "chat_rename"; label: string }
  | {
      type: "plan_submitted"
      planId: string
      plan: string
      toolEventId: string
    }
  | { type: "plan_approved"; planId: string }
  | { type: "plan_rejected"; planId: string; feedback: string }
  | { type: "done" }
