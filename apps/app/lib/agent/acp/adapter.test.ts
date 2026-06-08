import { describe, expect, it } from "vitest"
import type { ModelMessage, TextStreamPart, Tool } from "ai"
import {
  acpHistoryToModelMessages,
  agentChunksToRecord,
  aiSdkChunkToAcpUpdate,
  cachedSystem,
  thoughtChunksToRecord,
  withConversationCacheBreakpoint,
  ANTHROPIC_CACHE_BREAKPOINT,
} from "./adapter"
import type { AcpMessageRecord } from "./record"
import { textBlock } from "./schema"

/** A tiny ACP-native history: one user turn, one agent reply. */
function history(): AcpMessageRecord[] {
  return [
    { role: "user", content: [textBlock("hello")] },
    { role: "agent", content: [textBlock("hi there")] },
  ]
}

describe("acpHistoryToModelMessages (ACP-native history → ModelMessage[])", () => {
  it("maps user/agent records to user/assistant string-content messages", () => {
    expect(acpHistoryToModelMessages(history())).toEqual<ModelMessage[]>([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ])
  })

  it("concatenates multiple text blocks within a record", () => {
    const rebuilt = acpHistoryToModelMessages([
      { role: "agent", content: [textBlock("foo"), textBlock("bar")] },
    ])
    expect(rebuilt).toEqual([{ role: "assistant", content: "foobar" }])
  })

  // The carried prompt-cache risk: the rebuild must be deterministic so the
  // Anthropic cached prefix keeps matching across steps and turns.
  it("is deterministic — identical history rebuilds byte-identically", () => {
    const h = history()
    expect(acpHistoryToModelMessages(h)).toEqual(acpHistoryToModelMessages(h))
  })

  // Reasoning survives to history/screen but is never replayed as model input,
  // so the rebuilt request — and its cached prefix — is unaffected by thoughts.
  it("drops thought records from the rebuilt model input", () => {
    const rebuilt = acpHistoryToModelMessages([
      { role: "user", content: [textBlock("hello")] },
      { role: "thought", content: [textBlock("let me think")] },
      { role: "agent", content: [textBlock("hi there")] },
    ])
    expect(rebuilt).toEqual<ModelMessage[]>([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ])
  })

  it("keeps a stable prefix when a turn is appended (cache stays warm)", () => {
    const before = acpHistoryToModelMessages(history())
    const after = acpHistoryToModelMessages([
      ...history(),
      { role: "user", content: [textBlock("next")] },
    ])
    // Every message the previous request cached is byte-identical in the next
    // one — so the Anthropic breakpoint lands on a matching prefix.
    expect(after.slice(0, before.length)).toEqual(before)
  })
})

describe("cache breakpoint placement", () => {
  it("marks the system prompt with the ephemeral cache breakpoint", () => {
    expect(cachedSystem("sys")).toEqual({
      role: "system",
      content: "sys",
      providerOptions: ANTHROPIC_CACHE_BREAKPOINT,
    })
  })

  it("marks the last conversation message and leaves earlier ones untouched", () => {
    const marked = withConversationCacheBreakpoint(
      acpHistoryToModelMessages(history())
    )
    expect(marked[0]?.providerOptions).toBeUndefined()
    expect(marked[marked.length - 1]?.providerOptions).toMatchObject(
      ANTHROPIC_CACHE_BREAKPOINT
    )
  })

  it("is a no-op on empty history", () => {
    expect(withConversationCacheBreakpoint([])).toEqual([])
  })
})

describe("aiSdkChunkToAcpUpdate (streamText chunk → ACP update)", () => {
  it("maps a text-delta to an agent_message_chunk", () => {
    const chunk = {
      type: "text-delta",
      id: "t1",
      text: "tok",
    } as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toEqual({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "tok" },
    })
  })

  it("maps a reasoning-delta to an agent_thought_chunk", () => {
    const chunk = {
      type: "reasoning-delta",
      id: "r1",
      text: "hmm",
    } as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toEqual({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "hmm" },
    })
  })

  it("drops chunks with no text-path ACP signal (e.g. tool-call)", () => {
    const chunk = {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "x",
      input: {},
    } as unknown as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toBeNull()
  })
})

describe("thoughtChunksToRecord (streamed reasoning deltas → durable record)", () => {
  it("folds deltas into one thought record with a single text block", () => {
    expect(thoughtChunksToRecord(["think", "ing"])).toEqual({
      role: "thought",
      content: [textBlock("thinking")],
    })
  })

  it("yields an empty content list for a turn with no reasoning", () => {
    expect(thoughtChunksToRecord([])).toEqual({ role: "thought", content: [] })
  })
})

describe("agentChunksToRecord (streamed deltas → durable ACP record)", () => {
  it("folds deltas into one agent record with a single text block", () => {
    expect(agentChunksToRecord(["foo", "bar"])).toEqual({
      role: "agent",
      content: [textBlock("foobar")],
    })
  })

  it("yields an empty content list for a turn with no text", () => {
    expect(agentChunksToRecord([])).toEqual({ role: "agent", content: [] })
  })
})
