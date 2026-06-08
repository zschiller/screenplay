import type { ModelMessage, SystemModelMessage, TextStreamPart } from "ai"
import type { Tool } from "ai"
import {
  repairOrphanedAcpToolCalls,
  type AcpMessageRecord,
  type AcpToolCallRecord,
} from "./record"
import {
  agentMessageChunk,
  agentThoughtChunk,
  blockText,
  textBlock,
  toolCallStart,
  toolCallUpdate,
  type SessionUpdate,
  type ToolCallContent,
  type ToolKind,
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
 * into a single string. Tool-call records carry structured tool output, not
 * conversation text, so they contribute nothing here.
 */
export function recordText(record: AcpMessageRecord): string {
  if (record.role === "tool_call") return ""
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
 *
 * A `tool_call` record rebuilds into the assistant `tool-call` part **plus** the
 * matching `tool` result message the provider requires before a follow-up turn,
 * so the engine sees its own prior tool calls and their results on the next turn
 * (see {@link toolCallToModelMessages}). To keep the rebuild **well-formed** —
 * every tool-call part guaranteed a matching result — the history is first run
 * through {@link repairOrphanedAcpToolCalls}, which closes any call a crash
 * froze mid-flight to `failed` with an interrupted marker. That reuses the one
 * definition of the orphan-repair invariant rather than re-deriving "interrupted"
 * here, and is idempotent — a history already repaired on load
 * ({@link import("../persistence").loadAcpHistoryForModel}) is unchanged.
 *
 * `thought` records (the agent's reasoning) are **dropped** from the rebuild:
 * they survive to the screen and to durable history, but reasoning is not fed
 * back as model input. Skipping them is still a pure, order-preserving map, so
 * the cache-stable-prefix property holds.
 */
export function acpHistoryToModelMessages(
  history: AcpMessageRecord[]
): ModelMessage[] {
  return repairOrphanedAcpToolCalls(history).flatMap((record) => {
    switch (record.role) {
      // Reasoning survives to history/screen but is never replayed as input.
      case "thought":
        return []
      case "user":
        return [{ role: "user" as const, content: recordText(record) }]
      case "agent":
        return [{ role: "assistant" as const, content: recordText(record) }]
      case "tool_call":
        return toolCallToModelMessages(record)
    }
  })
}

/**
 * Flatten an ACP tool call's structured {@link ToolCallContent} blocks into the
 * single text string an AI-SDK `tool-result` carries — the same text path
 * {@link toolOutputToContent} produced on the way out. Non-text blocks (file
 * `diff`, `terminal`) contribute nothing to the model-facing text; richer block
 * round-tripping is a later slice.
 */
function toolResultText(content: ToolCallContent[]): string {
  return content
    .map((block) => (block.type === "content" ? blockText(block.content) : ""))
    .join("")
}

/**
 * Rebuild one durable {@link AcpToolCallRecord} into the `[assistant tool-call,
 * tool result]` pair the provider requires (ADR 0006). The two messages are
 * emitted **adjacently** — an assistant message carrying the `tool-call` part
 * immediately followed by the `tool` message carrying its `tool-result` — which
 * is the only shape Anthropic accepts (a `tool_result` must follow its
 * `tool_use`).
 *
 * `title` is the tool name (the in-process engine reports its tools' names
 * there) and `rawInput` the call's arguments. The result's text is every
 * content block flattened; by the time we get here {@link
 * repairOrphanedAcpToolCalls} has already closed any interrupted call, so an
 * orphan's content carries the interrupted marker and needs no special-casing —
 * the pair is well-formed for terminal and interrupted calls alike.
 */
function toolCallToModelMessages(record: AcpToolCallRecord): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: record.toolCallId,
          toolName: record.title,
          input: record.rawInput ?? {},
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: record.toolCallId,
          toolName: record.title,
          output: { type: "text", value: toolResultText(record.content) },
        },
      ],
    },
  ]
}

/**
 * The ACP {@link ToolKind} (icon/category hint) for one of screenplay's tools.
 * A generic ACP agent supplies its own `kind`; this is the in-process engine's
 * mapping for the tools it runs, defaulting to `"other"` for anything new.
 */
export function toolKindFor(toolName: string): ToolKind {
  switch (toolName) {
    case "read_file":
    case "read_document":
    case "read_skill":
    case "list_files":
      return "read"
    case "write_file":
    case "edit_file":
    case "replace_document_body":
    case "append_to_document_body":
    case "set_document_title":
      return "edit"
    case "run_command":
      return "execute"
    default:
      return "other"
  }
}

/**
 * Wrap a tool's return value as ACP {@link ToolCallContent}. The in-process
 * engine's tools return strings (or JSON-serialisable values), so this is the
 * text path — a single `content` block. A real ACP agent emits richer blocks
 * (file `diff`, `terminal`) directly, which flow through untouched.
 */
export function toolOutputToContent(output: unknown): ToolCallContent[] {
  const text = typeof output === "string" ? output : JSON.stringify(output)
  return text ? [{ type: "content", content: textBlock(text) }] : []
}

/**
 * Map a single `streamText` chunk to an ACP `session/update`, or `null` for
 * chunks that carry no ACP signal. Text deltas become `agent_message_chunk`s;
 * the tool chunks drive ACP's tool-call status lifecycle, keyed by tool-call id
 * (issue #377):
 *
 *  - `tool-input-start` → `tool_call` (`pending`): the call exists, args still
 *    streaming;
 *  - `tool-call` → `tool_call_update` (`in_progress`): args complete, executing;
 *  - `tool-result` → `tool_call_update` (`completed`) with structured content;
 *  - `tool-error` → `tool_call_update` (`failed`).
 *
 * `tool-input-start` keys on `id`; the later chunks key on `toolCallId` — the
 * same value — so every update lands on one record.
 */
export function aiSdkChunkToAcpUpdate(
  chunk: TextStreamPart<Record<string, Tool>>
): SessionUpdate | null {
  switch (chunk.type) {
    case "text-delta":
      return agentMessageChunk(chunk.text)
    case "reasoning-delta":
      // The agent's streamed thinking → ACP `agent_thought_chunk`, so reasoning
      // survives to broadcast/persistence instead of being dropped on the floor.
      return agentThoughtChunk(chunk.text)
    case "tool-input-start":
      return toolCallStart({
        toolCallId: chunk.id,
        title: chunk.toolName,
        kind: toolKindFor(chunk.toolName),
        status: "pending",
      })
    case "tool-call":
      return toolCallUpdate({
        toolCallId: chunk.toolCallId,
        status: "in_progress",
        title: chunk.toolName,
        rawInput: chunk.input as Record<string, unknown>,
      })
    case "tool-result":
      return toolCallUpdate({
        toolCallId: chunk.toolCallId,
        status: "completed",
        content: toolOutputToContent(chunk.output),
      })
    case "tool-error":
      return toolCallUpdate({
        toolCallId: chunk.toolCallId,
        status: "failed",
        content: toolOutputToContent(chunk.error),
      })
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

/**
 * Fold a sequence of `agent_thought_chunk` text runs into the single
 * ACP-native `thought` record persisted at turn end, mirroring
 * {@link agentChunksToRecord}. An empty (no-thought) turn yields an empty
 * content list, so no spurious reasoning record is written.
 */
export function thoughtChunksToRecord(texts: string[]): AcpMessageRecord {
  const joined = texts.join("")
  return {
    role: "thought",
    content: joined.length > 0 ? [textBlock(joined)] : [],
  }
}
