/**
 * Binding to the **genuine** Agent Client Protocol (ACP) schema.
 *
 * The seam between screenplay's server and whatever drives a Chat Session
 * speaks ACP, not a screenplay-flavoured approximation (see ADR 0006 and the
 * PRD in issue #375). We deliberately re-export the upstream
 * `@zed-industries/agent-client-protocol` types and Zod schemas rather than
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
 * Bound version: `@zed-industries/agent-client-protocol@0.4.x`.
 */
import {
  AgentSideConnection,
  ClientSideConnection,
  contentBlockSchema,
  ndJsonStream,
  PROTOCOL_VERSION,
  promptResponseSchema,
  sessionNotificationSchema,
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
} from "@zed-industries/agent-client-protocol"

export {
  AgentSideConnection,
  ClientSideConnection,
  contentBlockSchema,
  ndJsonStream,
  PROTOCOL_VERSION,
  promptResponseSchema,
  sessionNotificationSchema,
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
}

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
