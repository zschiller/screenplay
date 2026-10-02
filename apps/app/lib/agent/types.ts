import type { TargetedElement } from "@/lib/agent/message-markers"
// Tool names are derived from the builders, not hand-maintained: each builder's
// return type is its `{ name: Tool }` map, so the keys *are* the tool names.
// Add a tool to a builder and it shows up here automatically; there's no second
// list to drift. These are `import type` only — erased at build, so this stays
// client-safe even though the builders are server-only.
import type { buildSandboxTools } from "@/lib/agent/tools"
import type { buildDocumentTools } from "@/lib/agent/document-tools"
import type { buildLayerReadTools } from "@/lib/agent/layer-read-tools"
import type {
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from "@/lib/agent/acp/schema"

type AllTools = ReturnType<typeof buildSandboxTools> &
  ReturnType<typeof buildDocumentTools> &
  ReturnType<typeof buildLayerReadTools>

export type CustomToolName = keyof AllTools

export type AgentMessage =
  // `content` is the text the user message view draws; the typed fields come
  // from the user-turn projection (`user-turn.ts`), never from `content`.
  | {
      role: "user"
      content: string
      /** The Workspace whose turn ended, when this is a Coordinator wake. */
      wakeFrom?: string
      /** The sending Coordinator chat, when this is a Delegated Message. */
      delegatedFrom?: string
      /** Hover detail for the body's `element:` tokens, keyed by ref. */
      targetedElements?: TargetedElement[]
      /** The member who sent it, by user id, when the server recorded one. */
      sentBy?: string
    }
  | { role: "assistant"; content: string }
  // The agent's reasoning (ACP `agent_thought_chunk`), rendered in a collapsible
  // block distinct from the assistant message body so streamed thinking isn't
  // silently dropped.
  | { role: "reasoning"; content: string }
  // `content` is the plain sentence the chat shows; `detail`, when there is
  // one, is the raw error behind Copy error.
  | { role: "error"; content: string; detail?: string }
  // The user stopped the run here (its `agent_run` ended `aborted`). A marker,
  // not a message: it carries no content, only the fact that the turn above it
  // was cut short rather than finished, so a stopped run doesn't read as a
  // completed one.
  | { role: "stopped" }
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
  // place through its status lifecycle. This single row
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
      // Arbitrary JSON mirroring ACP (see AcpToolCallRecord) — narrow at use.
      rawInput?: unknown
      // Subagent parent linkage (issue #636/#639): the id of the `Task` call that
      // spawned this one, when the provider emits it. Present here so live and
      // reload carry the same shape; undefined for codex/main-agent calls, which
      // render flat. The visible grouping lands in a follow-up slice.
      parentToolCallId?: string
    }
