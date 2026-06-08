import type { ModelMessage, SystemModelMessage, TextStreamPart } from "ai"
import type { Tool } from "ai"
import type { AcpMessageRecord } from "./record"
import {
  agentMessageChunk,
  blockText,
  textBlock,
  type SessionUpdate,
} from "./schema"

/**
 * The in-process AI-SDK ⟷ ACP adapter (ADR 0006). The in-process engine is a
 * *translator*: it still runs `streamText`, but its input is rebuilt from
 * ACP-native history and its output is emitted as ACP `session/update`s. This
 * module owns both directions of that translation, and — crucially — the
 * prompt-cache breakpoint placement, because cache stability is a property of
 * how the rebuilt request is shaped.
 */

/**
 * An Anthropic ephemeral prompt-cache breakpoint. Anthropic caches the entire
 * request prefix up to (and including) a block carrying this marker, then
 * re-reads that prefix at ~10% of the input rate on the next request that
 * shares it. Other providers ignore the `anthropic`-namespaced options, so
 * it's safe to attach unconditionally regardless of `model`.
 *
 * Two breakpoints per request: one on the system prompt (caches tools + system,
 * stable across every turn) and one on the last conversation message (caches
 * history, stable across the tool-loop steps of a turn and back-to-back turns
 * within the 5-minute TTL). Without these, each step re-bills the full prefix
 * at the base rate — a ~10x cost multiplier on a 20-step loop.
 *
 * Moved here from the legacy loop so the ACP rebuild and the cache placement
 * have one owner: the adapter test pins that an ACP-native history rebuilds to
 * a byte-identical prefix, which is what keeps the cached prefix matching.
 */
export const ANTHROPIC_CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const

/** Wrap the system prompt as a cache-marked system message. */
export function cachedSystem(systemPrompt: string): SystemModelMessage {
  return {
    role: "system",
    content: systemPrompt,
    providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
  }
}

/**
 * Return a copy of `messages` with a cache breakpoint on the final message, so
 * the whole conversation prefix is cached. No-op for an empty list.
 */
export function withConversationCacheBreakpoint(
  messages: ModelMessage[]
): ModelMessage[] {
  if (messages.length === 0) return messages
  const out = messages.slice()
  const last = out[out.length - 1]!
  out[out.length - 1] = {
    ...last,
    providerOptions: { ...last.providerOptions, ...ANTHROPIC_CACHE_BREAKPOINT },
  }
  return out
}

/**
 * Concatenate every text {@link import("./schema").ContentBlock} of a record
 * into a single string. The text path only carries text blocks; richer block
 * types are added (structurally) by later slices.
 */
export function recordText(record: AcpMessageRecord): string {
  return record.content.map(blockText).join("")
}

/**
 * Rebuild AI-SDK `ModelMessage[]` from ACP-native history (ADR 0006).
 *
 * **Deterministic and stable by construction:** a pure, order-preserving map
 * with no timestamps, ids, or iteration over unordered structures, so the same
 * history always rebuilds to a byte-identical array. That stability is what
 * keeps the Anthropic prompt-cache prefix matching across steps and turns —
 * the carried risk the PRD calls out. The engine then marks the cache
 * breakpoints via {@link cachedSystem} / {@link withConversationCacheBreakpoint};
 * because this rebuild is stable, the marked prefix is too.
 *
 * For the text path each record maps 1:1 to a string-content message (`user`
 * record → user message, `agent` record → assistant message), which is the
 * shape Anthropic caches most cheaply.
 */
export function acpHistoryToModelMessages(
  history: AcpMessageRecord[]
): ModelMessage[] {
  return history.map((record) =>
    record.role === "user"
      ? { role: "user", content: recordText(record) }
      : { role: "assistant", content: recordText(record) }
  )
}

/**
 * Map a single `streamText` chunk to an ACP `session/update`, or `null` for
 * chunks that carry no ACP signal on the text path (tool calls/results, which
 * later slices translate). Text deltas become `agent_message_chunk`s.
 */
export function aiSdkChunkToAcpUpdate(
  chunk: TextStreamPart<Record<string, Tool>>
): SessionUpdate | null {
  switch (chunk.type) {
    case "text-delta":
      return agentMessageChunk(chunk.text)
    default:
      return null
  }
}

/**
 * Fold a sequence of `agent_message_chunk` text runs into the single
 * ACP-native agent record persisted at turn end. The accumulated text becomes
 * one text {@link import("./schema").ContentBlock}; an empty turn yields an
 * empty content list (no spurious record).
 */
export function agentChunksToRecord(texts: string[]): AcpMessageRecord {
  const joined = texts.join("")
  return {
    role: "agent",
    content: joined.length > 0 ? [textBlock(joined)] : [],
  }
}
