import { describe, expect, it } from "vitest"
import type { ModelMessage, TextStreamPart, Tool } from "ai"
import {
  acpHistoryToModelMessages,
  agentChunksToRecord,
  aiSdkChunkToAcpUpdate,
  cachedSystem,
  thoughtChunksToRecord,
  toolKindFor,
  toolOutputToContent,
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

  it("drops tool-call records from the text-path rebuild", () => {
    const rebuilt = acpHistoryToModelMessages([
      { role: "user", content: [textBlock("hi")] },
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "read_file",
        status: "completed",
        content: [],
      },
      { role: "agent", content: [textBlock("done")] },
    ])
    expect(rebuilt).toEqual<ModelMessage[]>([
      { role: "user", content: "hi" },
      { role: "assistant", content: "done" },
    ])
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

  it("maps tool-input-start to a pending tool_call with the tool's kind", () => {
    const chunk = {
      type: "tool-input-start",
      id: "c1",
      toolName: "read_file",
    } as unknown as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toEqual({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "read_file",
      kind: "read",
      status: "pending",
    })
  })

  it("maps tool-call to an in_progress tool_call_update carrying the input", () => {
    const chunk = {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "run_command",
      input: { command: "ls" },
    } as unknown as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "in_progress",
      title: "run_command",
      rawInput: { command: "ls" },
    })
  })

  it("maps tool-result to a completed update with structured content", () => {
    const chunk = {
      type: "tool-result",
      toolCallId: "c1",
      toolName: "read_file",
      output: "contents",
    } as unknown as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: textBlock("contents") }],
    })
  })

  it("maps tool-error to a failed update", () => {
    const chunk = {
      type: "tool-error",
      toolCallId: "c1",
      toolName: "read_file",
      error: "boom",
    } as unknown as TextStreamPart<Record<string, Tool>>
    expect(aiSdkChunkToAcpUpdate(chunk)).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "failed",
    })
  })

  it("still drops chunks with no ACP signal (e.g. text-start)", () => {
    const chunk = {
      type: "text-start",
      id: "t1",
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

describe("toolKindFor (screenplay tool → ACP kind)", () => {
  it("maps reads, edits, and execution; defaults to other", () => {
    expect(toolKindFor("read_file")).toBe("read")
    expect(toolKindFor("list_files")).toBe("read")
    expect(toolKindFor("edit_file")).toBe("edit")
    expect(toolKindFor("write_file")).toBe("edit")
    expect(toolKindFor("run_command")).toBe("execute")
    expect(toolKindFor("create_pr")).toBe("other")
    expect(toolKindFor("brand_new_tool")).toBe("other")
  })
})

describe("toolOutputToContent (tool output → ACP content)", () => {
  it("wraps a string as a single text content block", () => {
    expect(toolOutputToContent("hello")).toEqual([
      { type: "content", content: textBlock("hello") },
    ])
  })

  it("JSON-encodes a non-string output", () => {
    expect(toolOutputToContent({ ok: true })).toEqual([
      { type: "content", content: textBlock('{"ok":true}') },
    ])
  })

  it("yields no content for empty output", () => {
    expect(toolOutputToContent("")).toEqual([])
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
