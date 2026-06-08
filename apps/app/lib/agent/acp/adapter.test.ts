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
import { repairOrphanedAcpToolCalls, type AcpMessageRecord } from "./record"
import { textBlock } from "./schema"

/** A tiny ACP-native history: one user turn, one agent reply. */
function history(): AcpMessageRecord[] {
  return [
    { role: "user", content: [textBlock("hello")] },
    { role: "agent", content: [textBlock("hi there")] },
  ]
}

/**
 * Assert every `tool-call` part in a rebuilt request has a matching
 * `tool-result` further along — the well-formedness the provider requires. A
 * standalone checker (rather than importing the server-only `ModelMessage`
 * repair) so the pure-function test stays dependency-free.
 */
function assertToolCallsWellFormed(messages: ModelMessage[]): void {
  const resultIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role !== "tool" || typeof msg.content === "string") continue
    for (const part of msg.content) {
      if (part.type === "tool-result") resultIds.add(part.toolCallId)
    }
  }
  for (const msg of messages) {
    if (msg.role !== "assistant" || typeof msg.content === "string") continue
    for (const part of msg.content) {
      if (part.type === "tool-call") {
        expect(resultIds.has(part.toolCallId)).toBe(true)
      }
    }
  }
}

/** An ACP-native history whose turn includes a completed tool call. */
function historyWithToolCall(): AcpMessageRecord[] {
  return [
    { role: "user", content: [textBlock("read a")] },
    {
      role: "tool_call",
      toolCallId: "c1",
      title: "read_file",
      status: "completed",
      content: [{ type: "content", content: textBlock("body") }],
      rawInput: { path: "a" },
    },
    { role: "agent", content: [textBlock("here it is")] },
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

  it("rebuilds a completed tool-call into an assistant tool-call + tool result pair", () => {
    const rebuilt = acpHistoryToModelMessages([
      { role: "user", content: [textBlock("hi")] },
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "read_file",
        status: "completed",
        content: [{ type: "content", content: textBlock("file body") }],
        rawInput: { path: "a.txt" },
      },
      { role: "agent", content: [textBlock("done")] },
    ])
    expect(rebuilt).toEqual<ModelMessage[]>([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read_file",
            output: { type: "text", value: "file body" },
          },
        ],
      },
      { role: "assistant", content: "done" },
    ])
  })

  // Well-formedness: the model never sees a tool call without its result. The
  // assistant tool-call part and its tool-result land adjacently, so the
  // Anthropic "tool_result must follow tool_use" rule holds.
  it("keeps every tool-call part adjacent to its matching tool result", () => {
    const rebuilt = acpHistoryToModelMessages([
      { role: "user", content: [textBlock("go")] },
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "list_files",
        status: "completed",
        content: [{ type: "content", content: textBlock("a\nb") }],
        rawInput: {},
      },
      {
        role: "tool_call",
        toolCallId: "c2",
        title: "read_file",
        status: "completed",
        content: [{ type: "content", content: textBlock("hello") }],
        rawInput: { path: "a" },
      },
    ])
    assertToolCallsWellFormed(rebuilt)
  })

  // A tool call carrying no output (a void/empty result) is still rebuilt into a
  // well-formed pair — an empty-string result, never a dropped call.
  it("rebuilds a tool-call with empty content into an empty-string result", () => {
    const rebuilt = acpHistoryToModelMessages([
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "run_command",
        status: "completed",
        content: [],
        rawInput: { command: "true" },
      },
    ])
    expect(rebuilt).toEqual<ModelMessage[]>([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "run_command",
            input: { command: "true" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "run_command",
            output: { type: "text", value: "" },
          },
        ],
      },
    ])
  })

  // An absent `rawInput` rebuilds to empty args, not `undefined` — a stable,
  // serialisable shape the provider accepts.
  it("defaults a tool-call with no rawInput to empty args", () => {
    const rebuilt = acpHistoryToModelMessages([
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "read_file",
        status: "completed",
        content: [],
      },
    ])
    expect(rebuilt[0]).toEqual<ModelMessage>({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "read_file",
          input: {},
        },
      ],
    })
  })

  // A crash between a call going in_progress and its result leaves a non-terminal
  // orphan. The rebuild closes it to a synthetic interrupted result (reusing the
  // orphan-repair invariant), so the model still sees a well-formed pair.
  it("gives a non-terminal tool-call a synthetic interrupted result", () => {
    const rebuilt = acpHistoryToModelMessages([
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "run_command",
        status: "in_progress",
        content: [],
        rawInput: { command: "ls" },
      },
    ])
    expect(rebuilt).toEqual<ModelMessage[]>([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "run_command",
            input: { command: "ls" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "run_command",
            output: { type: "text", value: "Tool execution was interrupted." },
          },
        ],
      },
    ])
  })

  // The orphan-repair invariant survives the history → ModelMessage[] round-trip:
  // converting straight from an un-repaired log yields the same well-formed
  // result as repairing the log first, and the output is well-formed either way.
  it("survives the orphan-repair round-trip from an un-repaired log", () => {
    const log: AcpMessageRecord[] = [
      { role: "user", content: [textBlock("hi")] },
      {
        role: "tool_call",
        toolCallId: "c1",
        title: "read_file",
        status: "pending",
        content: [],
        rawInput: { path: "a" },
      },
    ]
    const direct = acpHistoryToModelMessages(log)
    // Repairing first, then converting, gives the identical result — the
    // conversion reuses (and is idempotent under) the repair invariant.
    expect(acpHistoryToModelMessages(repairOrphanedAcpToolCalls(log))).toEqual(
      direct
    )
    assertToolCallsWellFormed(direct)
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

  // The rebuilt tool-call/result pair must be just as prefix-stable as the text
  // path, or a turn that ran tools would bust the cache on the very next turn.
  it("keeps a stable prefix when a turn is appended after a tool call", () => {
    const before = acpHistoryToModelMessages(historyWithToolCall())
    const after = acpHistoryToModelMessages([
      ...historyWithToolCall(),
      { role: "user", content: [textBlock("next")] },
    ])
    expect(after.slice(0, before.length)).toEqual(before)
    assertToolCallsWellFormed(after)
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
