import { describe, expect, it, vi } from "vitest"

// The engine resolves its model through the providers module; every test here
// swaps in a mock model, so stub the resolution that would demand API keys.
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

import { jsonSchema, streamText, tool } from "ai"
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test"
import { InProcessEngine } from "./in-process-engine"
import { textBlock } from "./schema"

// Unlike the contract suites, which drive the engine with a scripted fake of
// `streamText`, these run the real AI SDK multi-step loop over a mock model, so
// they pin the SDK semantics the engine depends on: how a `prepareStep`
// messages override carries between steps, and which response messages
// `onEnd` hands back.

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

type Step = { toolCall: string } | { text: string }

function stepStream(step: Step) {
  const parts =
    "toolCall" in step
      ? [
          {
            type: "tool-call" as const,
            toolCallId: step.toolCall,
            toolName: "echo",
            input: "{}",
          },
          {
            type: "finish" as const,
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage,
          },
        ]
      : [
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: step.text },
          { type: "text-end" as const, id: "t" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            usage,
          },
        ]
  return {
    stream: convertArrayToReadableStream([
      { type: "stream-start" as const, warnings: [] },
      ...parts,
    ]),
  }
}

function mockModel(steps: Step[]) {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async () => stepStream(steps[call++]!),
  })
}

const echo = tool({
  inputSchema: jsonSchema<Record<string, never>>({ type: "object" }),
  execute: async () => "echoed",
})

function steersAt(calls: Record<number, string>) {
  let call = 0
  return async () => {
    const text = calls[++call]
    return text ? [{ id: `s${call}`, content: [textBlock(text)] }] : []
  }
}

async function runTurn(
  model: MockLanguageModelV4,
  takeSteers: () => Promise<
    Array<{ id: string; content: ReturnType<typeof textBlock>[] }>
  >,
  modelId = "anthropic:test"
) {
  const engine = new InProcessEngine((config) =>
    streamText({ ...config, model })
  )
  const done: string[] = []
  await engine.run(
    {
      chatId: "c",
      runId: "r",
      roomId: "rm",
      systemPrompt: "SYS",
      model: modelId,
      history: [{ role: "user", content: [textBlock("start")] }],
      tools: { echo },
      takeSteers,
    },
    (u) => {
      if (u.kind === "done") done.push(u.stopReason)
      if (u.kind === "error") done.push(`error: ${u.message}`)
    },
    new AbortController().signal
  )
  return done
}

/** The roles and a short tag per message of the prompt one model step got. */
function shape(prompt: unknown): string[] {
  return (prompt as Array<{ role: string; content: unknown }>).map((m) => {
    if (typeof m.content === "string") return `${m.role}:${m.content}`
    const parts = m.content as Array<Record<string, unknown>>
    return `${m.role}:${parts
      .map((p) =>
        p.type === "text"
          ? p.text
          : p.type === "tool-call"
            ? `call(${p.toolCallId})`
            : p.type === "tool-result"
              ? `result(${p.toolCallId})`
              : p.type
      )
      .join("+")}`
  })
}

describe("InProcessEngine over the real AI SDK loop", () => {
  it("asks a Claude 5 model for summarized thinking, so Reasoning has text", async () => {
    const model = mockModel([{ text: "done" }])
    await runTurn(model, steersAt({}), "anthropic:claude-sonnet-5-5")

    expect(model.doStreamCalls[0]!.providerOptions).toEqual({
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    })
  })

  it("keeps a mid-pass Steer where it joined, once, on every later step", async () => {
    const model = mockModel([
      { toolCall: "a" },
      { toolCall: "b" },
      { text: "done" },
    ])
    // Call 1 is before step 0, call 2 before step 1: the Steer joins there.
    const done = await runTurn(model, steersAt({ 2: "also this" }))

    expect(done).toEqual(["end_turn"])
    const prompts = model.doStreamCalls.map((c) => shape(c.prompt))
    expect(prompts[1]).toEqual([
      "system:SYS",
      "user:start",
      "assistant:call(a)",
      "tool:result(a)",
      "user:also this",
    ])
    expect(prompts[2]).toEqual([
      "system:SYS",
      "user:start",
      "assistant:call(a)",
      "tool:result(a)",
      "user:also this",
      "assistant:call(b)",
      "tool:result(b)",
    ])
  })

  it("continues a Steer sent after the pass over every step's responses", async () => {
    const model = mockModel([
      { toolCall: "a" },
      { text: "done" },
      { text: "ok" },
    ])
    // Calls 1-2 are the pass's steps; call 3 is the check after it ends.
    const done = await runTurn(model, steersAt({ 3: "one more" }))

    expect(done).toEqual(["end_turn"])
    expect(shape(model.doStreamCalls[2]!.prompt)).toEqual([
      "system:SYS",
      "user:start",
      "assistant:call(a)",
      "tool:result(a)",
      "assistant:done",
      "user:one more",
    ])
  })
})

describe("InProcessEngine naming the layer a call works on (#1725)", () => {
  it("sends the Mockup id while the page is still streaming", async () => {
    const input = '{"mockup_id": "mock-1", "html": "<p>A long page</p>"}'
    const updateStep = convertArrayToReadableStream([
      { type: "stream-start" as const, warnings: [] },
      {
        type: "tool-input-start" as const,
        id: "u1",
        toolName: "update_mockup",
      },
      ...[input.slice(0, 30), input.slice(30)].map((delta) => ({
        type: "tool-input-delta" as const,
        id: "u1",
        delta,
      })),
      { type: "tool-input-end" as const, id: "u1" },
      {
        type: "tool-call" as const,
        toolCallId: "u1",
        toolName: "update_mockup",
        input,
      },
      {
        type: "finish" as const,
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
      },
    ])
    let call = 0
    const model = new MockLanguageModelV4({
      doStream: async () =>
        call++ === 0 ? { stream: updateStep } : stepStream({ text: "done" }),
    })
    const engine = new InProcessEngine((config) =>
      streamText({ ...config, model })
    )
    const updates: string[] = []
    await engine.run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "SYS",
        model: "anthropic:test",
        history: [{ role: "user", content: [textBlock("start")] }],
        tools: {
          update_mockup: tool({
            inputSchema: jsonSchema<{ mockup_id: string; html: string }>({
              type: "object",
            }),
            execute: async () => "Updated",
          }),
        },
        takeSteers: async () => [],
      },
      (u) => {
        if (u.kind !== "session_update") return
        const up = u.update as {
          sessionUpdate: string
          status?: string
          rawInput?: unknown
        }
        updates.push(
          `${up.sessionUpdate} ${up.status ?? "-"} ${JSON.stringify(up.rawInput ?? null)}`
        )
      },
      new AbortController().signal
    )

    // The id arrives on its own, before the whole input does.
    expect(updates.slice(0, 3)).toEqual([
      "tool_call pending null",
      'tool_call_update - {"mockup_id":"mock-1"}',
      `tool_call_update in_progress ${JSON.stringify(JSON.parse(input))}`,
    ])
  })
})
