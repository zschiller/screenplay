/**
 * Binding to the **genuine** Agent Client Protocol (ACP) schema.
 *
 * The seam between screenplay's server and whatever drives a Chat Session
 * speaks ACP, not a screenplay-flavoured approximation (see ADR 0006 and the
 * PRD in issue #375). We deliberately re-export the upstream
 * `@agentclientprotocol/sdk` types and Zod schemas rather than
 * hand-rolling our own message shapes, so that:
 *
 *  - the eventual swap to a real ACP client is *subtractive* — the UI, the
 *    persisted log, and the engine boundary already speak the target language;
 *  - the contract test is load-bearing: it pins behaviour against the real
 *    `sessionUpdate` vocabulary, so a drift from the spec is a compile/test
 *    failure, not a silent divergence.
 *
 * This module is the single import surface for ACP types in the app. Everything
 * else imports from here so the upstream package name appears in exactly one
 * place and the version we bind to is documented. Besides the message
 * vocabulary it also re-exports the protocol *machinery* the client side binds
 * to — the {@link ClientSideConnection} that speaks ACP over a {@link Stream},
 * the negotiated {@link PROTOCOL_VERSION}, and `ndJsonStream` for the stdio
 * transport — plus the {@link AgentSideConnection} the in-memory test fake runs
 * on, so even the agent-side binding stays in this one place.
 *
 * Bound version: `@agentclientprotocol/sdk@0.14.x` — the renamed successor of
 * `@zed-industries/agent-client-protocol` (frozen at 0.4.5), and the generation
 * the real `claude-code-acp` adapter speaks. Migrated from 0.4.5 to fix dropped
 * `tool_call_update`s whose `rawOutput` the older schema rejected.
 */
import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AnyMessage,
  type Client,
  type ContentBlock,
  type InitializeResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
  type ToolCallContent,
  type ToolCallStatus,
  type ToolCallUpdate,
  type ToolKind,
} from "@agentclientprotocol/sdk"
// The runtime Zod schema for a `session/update` notification. The SDK names its
// generated schemas `z<Name>` and doesn't surface them from the main entry, so
// we reach it by its module path and re-export it under the screenplay-facing
// name. Used to assert the genuine adapter's wire shapes parse (schema.test.ts).
import { zSessionNotification } from "@agentclientprotocol/sdk/dist/schema/zod.gen.js"

/** The genuine ACP `session/update` notification schema (SDK `zSessionNotification`). */
export const sessionNotificationSchema = zSessionNotification

export {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AnyMessage,
  type Client,
  type ContentBlock,
  type InitializeResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
  type ToolCallUpdate,
  // Tool-call vocabulary (ADR 0006, issue #377). `ToolCallContent` is the
  // structured tool output (a text/image content block, a file `diff`, or a
  // `terminal` handle); `ToolCallStatus` is the lifecycle (`pending` →
  // `in_progress` → `completed`/`failed`); `ToolKind` is the icon/category hint.
  // Re-exported here so the rest of the app binds to the genuine ACP shapes.
  type ToolCallContent,
  type ToolCallStatus,
  type ToolKind,
}

/** The human's decision on a {@link RequestPermissionResponse}. */
export type RequestPermissionOutcome = RequestPermissionResponse["outcome"]

/**
 * The body of an ACP `session/update` notification — the discriminated union
 * over `sessionUpdate` (message chunks, thought chunks, tool calls, plan, …).
 * This is the seam's update vocabulary.
 */
export type SessionUpdate = SessionNotification["update"]

/** Why the agent stopped processing a prompt turn (ACP `PromptResponse`). */
export type StopReason = PromptResponse["stopReason"]

/** A single `sessionUpdate` discriminant value (e.g. `"agent_message_chunk"`). */
export type SessionUpdateKind = SessionUpdate["sessionUpdate"]

/** Narrow a {@link SessionUpdate} to a specific `sessionUpdate` discriminant. */
export function isUpdate<K extends SessionUpdateKind>(
  update: SessionUpdate,
  kind: K
): update is Extract<SessionUpdate, { sessionUpdate: K }> {
  return update.sessionUpdate === kind
}

/** Build a plain-text ACP {@link ContentBlock}. */
export function textBlock(text: string): ContentBlock {
  return { type: "text", text }
}

/**
 * The text of a {@link ContentBlock}, or `""` for non-text blocks. The text
 * path only ever produces/consumes text blocks; richer block types (image,
 * resource, …) are carried structurally by later slices.
 */
export function blockText(block: ContentBlock): string {
  return block.type === "text" ? block.text : ""
}

/** An `agent_message_chunk` session update carrying a run of streamed text. */
export function agentMessageChunk(text: string): SessionUpdate {
  return { sessionUpdate: "agent_message_chunk", content: textBlock(text) }
}

/**
 * An `agent_thought_chunk` session update carrying a run of the agent's
 * streamed reasoning/thinking. Same content shape as
 * {@link agentMessageChunk}, but ACP keeps it a distinct `sessionUpdate` so the
 * UI can render reasoning apart from the assistant's message body and agents
 * that stream thinking aren't silently dropped.
 */
export function agentThoughtChunk(text: string): SessionUpdate {
  return { sessionUpdate: "agent_thought_chunk", content: textBlock(text) }
}

/** A `user_message_chunk` session update carrying the user's prompt text. */
export function userMessageChunk(text: string): SessionUpdate {
  return { sessionUpdate: "user_message_chunk", content: textBlock(text) }
}

/**
 * The screenplay plan-mode approval gate, expressed in ACP.
 *
 * screenplay's gate (`submit_plan` halt → `RunState.pauseForPlan` → resume via
 * `/api/agent/plan`) maps onto ACP's **permission request** (`RequestPermission`
 * — the agent asking the client to authorise an operation before proceeding),
 * *not* onto ACP's informational `plan` `session/update` (the agent's evolving
 * TODO list, which is a separate signal the UI may also render). Conflating the
 * two would make a real ACP client's `plan` updates trip the approval gate and
 * break the swap (PRD #375, design goal 1).
 *
 * The two are kept structurally distinct: the gate is a `permission_request`
 * EngineUpdate carrying a {@link RequestPermissionRequest}; the TODO list is a
 * `session_update` whose `sessionUpdate` is `"plan"`. {@link isPlanGate}
 * recognises *our* gate among arbitrary permission requests by its option ids.
 */

/** The submit-plan tool name the gate's `toolCall` is reported under. */
export const SUBMIT_PLAN_TOOL = "submit_plan"

/** Option id the human selects to approve a plan and let the agent proceed. */
export const PLAN_APPROVE_OPTION_ID = "approve"
/** Option id the human selects to reject a plan (feedback drives a revision). */
export const PLAN_REJECT_OPTION_ID = "reject"

/**
 * Build the ACP permission request for screenplay's plan-mode gate. The plan
 * text rides the request's `toolCall` as an ACP content block (its native
 * slot); `toolCallId` is the verbatim submit-plan tool-call id, so it lines up
 * with the pending row the pause inserts and the id the resume keys off.
 */
export function planPermissionRequest(opts: {
  sessionId: string
  toolCallId: string
  plan: string
}): RequestPermissionRequest {
  return {
    sessionId: opts.sessionId,
    toolCall: {
      toolCallId: opts.toolCallId,
      title: "Review plan",
      kind: "other",
      status: "pending",
      content: [{ type: "content", content: textBlock(opts.plan) }],
      rawInput: { plan: opts.plan },
    },
    options: [
      {
        optionId: PLAN_APPROVE_OPTION_ID,
        name: "Approve",
        kind: "allow_once",
      },
      {
        optionId: PLAN_REJECT_OPTION_ID,
        name: "Request changes",
        kind: "reject_once",
      },
    ],
  }
}

/**
 * A `tool_call` session update — the *creation* of a tool call, keyed by
 * `toolCallId` (ADR 0006, issue #377). Defaults to `pending`; the agent then
 * advances it with {@link toolCallUpdate}s through the status lifecycle.
 */
export function toolCallStart(params: {
  toolCallId: string
  title: string
  kind?: ToolKind
  status?: ToolCallStatus
  rawInput?: Record<string, unknown>
  content?: ToolCallContent[]
}): SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId: params.toolCallId,
    title: params.title,
    status: params.status ?? "pending",
    ...(params.kind ? { kind: params.kind } : {}),
    ...(params.rawInput ? { rawInput: params.rawInput } : {}),
    ...(params.content ? { content: params.content } : {}),
  }
}

/**
 * Whether a permission request is screenplay's plan-mode gate (rather than some
 * other ACP permission round-trip a generic agent might raise). Recognised by
 * the gate's two option ids — keeping the gate distinct from the informational
 * `plan` update *and* from unrelated permission requests.
 */
export function isPlanGate(request: RequestPermissionRequest): boolean {
  const ids = new Set(request.options.map((o) => o.optionId))
  return ids.has(PLAN_APPROVE_OPTION_ID) && ids.has(PLAN_REJECT_OPTION_ID)
}

/** Recover the `{ toolCallId, plan }` a plan-gate permission request carries. */
export function planFromPermissionRequest(request: RequestPermissionRequest): {
  toolCallId: string
  plan: string
} {
  const raw = request.toolCall.rawInput as { plan?: string } | undefined
  const fromContent = (request.toolCall.content ?? [])
    .map((c) => (c.type === "content" ? blockText(c.content) : ""))
    .join("")
  return {
    toolCallId: request.toolCall.toolCallId,
    plan: raw?.plan ?? fromContent,
  }
}

/**
 * The ACP-native record of the human's decision on a plan gate — the
 * `RequestPermissionResponse` outcome that the swap target produces verbatim.
 * Approve selects the approve option; reject selects the reject option.
 */
export function planResolutionOutcome(
  approved: boolean
): RequestPermissionOutcome {
  return {
    outcome: "selected",
    optionId: approved ? PLAN_APPROVE_OPTION_ID : PLAN_REJECT_OPTION_ID,
  }
}

/**
 * A `tool_call_update` session update — an in-place change to an existing tool
 * call keyed by `toolCallId`. Only the supplied fields are carried; the
 * consumer/renderer merge them onto the record they already hold for that id.
 */
export function toolCallUpdate(params: {
  toolCallId: string
  status?: ToolCallStatus
  title?: string
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
  content?: ToolCallContent[]
}): SessionUpdate {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: params.toolCallId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.title ? { title: params.title } : {}),
    ...(params.rawInput ? { rawInput: params.rawInput } : {}),
    ...(params.rawOutput ? { rawOutput: params.rawOutput } : {}),
    ...(params.content ? { content: params.content } : {}),
  }
}
