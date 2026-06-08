import type { ContentBlock } from "./schema"

/**
 * The ACP-native durable conversation record — what we persist instead of the
 * AI-SDK `ModelMessage[]` for the text path (ADR 0006). One row per logical
 * message; its `content` is genuine ACP {@link ContentBlock}s.
 *
 * ACP itself streams *updates* and assumes the agent owns session state; here
 * the server's persisted log *is* that state, so a late joiner or a reload
 * rebuilds from these records. Tool calls and structured tool content become
 * additional record kinds in later slices.
 *
 * `role` mirrors ACP's `user_message_chunk` / `agent_message_chunk` /
 * `agent_thought_chunk` split: `"agent"` (not `"assistant"`) is the ACP term,
 * and `"thought"` is the agent's reasoning — persisted so reload/replay keep it,
 * but kept distinct from the message body (it is *not* replayed into the model's
 * input; see {@link import("./adapter").acpHistoryToModelMessages}).
 */
export type AcpMessageRecord =
  | { role: "user"; content: ContentBlock[] }
  | { role: "agent"; content: ContentBlock[] }
  | { role: "thought"; content: ContentBlock[] }
