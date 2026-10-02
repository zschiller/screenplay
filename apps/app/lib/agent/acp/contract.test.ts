import { describe, expect, it, vi } from "vitest"

// The in-process engine binds to the model providers at import time; none of
// that is exercised here — every test injects a fake stream driver — so stub
// the provider resolution that would otherwise demand real API keys.
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))
// `run-state` binds to the live Drizzle handle at import time; the `/stop`
// contract drives a real `createRunState` over an in-memory repo, so stub the
// db boundary that would otherwise demand a real DATABASE_URL (mirrors
// consumer.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import { jsonSchema, tool, type ModelMessage } from "ai"
import type { DeliverSteer, EngineUpdate, TakenSteer } from "./engine-seam"
import {
  blockText,
  textBlock,
  type ContentBlock,
  type SessionUpdate,
  type StopReason,
} from "./schema"
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import { ExternalEngine, type AcpSessionFactory } from "./acp-engine"
import type { AcpSession, AcpSessionPorts, SteerOutcome } from "./session"
import {
  acpSessionFactoryFromDriver,
  contractFor,
  steeringContractFor,
  steppedDriver,
  stopGateContractFor,
} from "./engine-contract"

contractFor("in-process", (driver) => new InProcessEngine(driver))
steeringContractFor("in-process", (driver) => new InProcessEngine(driver))
stopGateContractFor("in-process", (driver) => new InProcessEngine(driver))

// The ACP engine plugs into the *same* contract, driven by the *same* scenario:
// a generic ACP agent scripted by the `StreamDriver` runs the turn over a real
// (in-memory) ACP transport, and the engine passes its `session/update`s through
// to the consumer. Both engines reaching the identical observable outcome is the
// executable proof the seam is honest, not nominal (ADR 0006, PRD #375). The
// production transport — the *same* engine over a real spawned subprocess — runs
// this contract too, in `spawn-session-factory.test.ts`.
contractFor(
  "external",
  (driver) =>
    new ExternalEngine({ sessionFactory: acpSessionFactoryFromDriver(driver) })
)

stopGateContractFor(
  "external",
  (driver) =>
    new ExternalEngine({ sessionFactory: acpSessionFactoryFromDriver(driver) })
)

// The Claude adapter queues a prompt sent while one runs into the live turn
// (#1191); the fake agent learns the same, and the external Engine steers
// through it to the same observable outcome as the in-process one.
steeringContractFor(
  "external",
  (driver) =>
    new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(driver, {
        promptQueueing: true,
      }),
    })
)

// Codex's adapter takes a mid-turn message through its steering request
// instead (#1192); the same contract holds through it.
steeringContractFor(
  "external (steering request)",
  (driver) =>
    new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(driver, { steering: {} }),
    })
)

describe("ExternalEngine — steering", () => {
  const turn = {
    chatId: "c",
    runId: "r",
    roomId: "rm",
    systemPrompt: "",
    model: "harness:claude-code",
    history: [{ role: "user" as const, content: [textBlock("hi")] }],
  }
  const reply = (): StreamDriver => (config) => ({
    consumeStream: async () => {
      await config.onChunk?.({
        chunk: { type: "text-delta", id: "t", text: "ok" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await config.onEnd?.({ finishReason: "stop" } as any)
    },
  })

  it("reports no Steers once the session is open on a Harness that doesn't queue prompts, and takes none", async () => {
    const takeSteers = vi.fn(async () => [])
    const reportSteering = vi.fn(async (_steers: boolean) => {})
    const updates: EngineUpdate[] = []
    await new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(reply()),
    }).run(
      { ...turn, takeSteers, reportSteering },
      (u) => {
        updates.push(u)
      },
      new AbortController().signal
    )
    expect(reportSteering.mock.calls).toEqual([[false]])
    expect(takeSteers).not.toHaveBeenCalled()
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
  })

  it("treats the handoff's end_turn as part of the turn, ending once with the steered reply", async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const call = (type: string, extra: object) =>
      ({ type, toolCallId: "call_1", toolName: "read_file", ...extra }) as any
    let steer = () => {}
    const driver = steppedDriver(
      [
        [
          {
            chunks: [
              {
                type: "tool-input-start",
                id: "call_1",
                toolName: "read_file",
              } as any,
              call("tool-call", { input: {} }),
              () => steer(),
              call("tool-result", { output: "x" }),
            ],
            response: [],
          },
          {
            // The steered step outlasts the handoff that started it.
            chunks: [
              () => new Promise((resolve) => setTimeout(resolve, 20)),
              { type: "text-delta", id: "t", text: "Steered." } as any,
            ],
            response: [],
          },
        ],
      ],
      []
    )
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const inbox: string[] = []
    steer = () => {
      inbox.push("run the tests too")
    }
    const updates: EngineUpdate[] = []
    await new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(driver, {
        promptQueueing: true,
      }),
    }).run(
      {
        ...turn,
        takeSteers: async () =>
          inbox.splice(0).map((text, i) => ({
            id: `s${i}`,
            content: [textBlock(text)],
          })),
      },
      (u) => {
        updates.push(u)
      },
      new AbortController().signal
    )
    expect(updates.filter((u) => u.kind === "done")).toHaveLength(1)
    expect(updates.at(-2)).toMatchObject({
      kind: "session_update",
      update: { sessionUpdate: "agent_message_chunk" },
    })
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
  })

  it("a stop ends the agent, and nothing it streams afterwards reaches the chat", async () => {
    const close = vi.fn()
    let ports: AcpSessionPorts | undefined
    const inner = acpSessionFactoryFromDriver(
      () => ({
        consumeStream: async () => {
          throw new Error("aborted")
        },
      }),
      { promptQueueing: true }
    )
    const updates: EngineUpdate[] = []
    const controller = new AbortController()
    controller.abort()
    await new ExternalEngine({
      sessionFactory: {
        async open(p, options) {
          ports = p
          const session = await inner.open(p, options)
          session.onClose(close)
          return session
        },
      },
    }).run(
      { ...turn, takeSteers: async () => [] },
      (u) => {
        updates.push(u)
      },
      controller.signal
    )
    expect(close).toHaveBeenCalledTimes(1)
    expect(updates).toEqual([{ kind: "done", stopReason: "cancelled" }])

    // A Steer the agent had already taken keeps it working past the cancel.
    await ports!.onUpdate({
      sessionUpdate: "agent_message_chunk",
      content: textBlock("still going"),
    })
    expect(updates).toHaveLength(1)
  })

  // What it says past the cancel the consumer drops, as for every Engine
  // (`stopGateContractFor`).
  it("a stop ends an agent that keeps working past the cancel, and reports the stop", async () => {
    const updates: EngineUpdate[] = []
    const controller = new AbortController()
    const run = new ExternalEngine({
      // An agent that never answers the cancel and keeps talking, like one
      // still working a Steer it had taken.
      sessionFactory: acpSessionFactoryFromDriver(
        (config) => ({
          consumeStream: async () => {
            controller.abort()
            await config.onChunk?.({
              chunk: { type: "text-delta", id: "t", text: "Noted." },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            return new Promise<void>(() => {})
          },
        }),
        { promptQueueing: true }
      ),
      stopGraceMs: 10,
    }).run(
      { ...turn, takeSteers: async () => [] },
      (u) => {
        updates.push(u)
      },
      controller.signal
    )
    await run
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "cancelled" })
    expect(updates.filter((u) => u.kind === "done")).toHaveLength(1)
  })

  // Every turn ends its agent, so the next turn's `session/load` doesn't meet a
  // live one: Codex's adapter refuses a load while another process holds the
  // thread (#1271).
  it("a turn that ends on its own ends its agent too", async () => {
    const close = vi.fn()
    const inner = acpSessionFactoryFromDriver(reply(), { promptQueueing: true })
    await new ExternalEngine({
      sessionFactory: {
        async open(p, options) {
          const session = await inner.open(p, options)
          session.onClose(close)
          return session
        },
      },
    }).run(turn, () => {}, new AbortController().signal)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("reports Steers on a Harness that queues prompts, checking once before it finishes", async () => {
    const takeSteers = vi.fn(async () => [])
    const reportSteering = vi.fn(async (_steers: boolean) => {})
    await new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(reply(), {
        promptQueueing: true,
      }),
    }).run(
      { ...turn, takeSteers, reportSteering },
      () => {},
      new AbortController().signal
    )
    expect(reportSteering.mock.calls).toEqual([[true]])
    expect(takeSteers).toHaveBeenCalledTimes(1)
  })
})

describe("ExternalEngine — Codex steering request (#1192)", () => {
  const turn = {
    chatId: "c",
    runId: "r",
    roomId: "rm",
    systemPrompt: "",
    model: "harness:codex",
    history: [{ role: "user" as const, content: [textBlock("hi")] }],
  }
  const text = (steer: TakenSteer) =>
    steer.content.map((b) => ("text" in b ? b.text : "")).join("")

  /** A Steer inbox with the live route's `deliver` handling (see live-turn). */
  function inboxOf(texts: string[]) {
    const pending = texts.map((t, i) => ({
      id: `s${i + 1}`,
      content: [textBlock(t)],
    }))
    const settled: string[] = []
    const takeSteers = async (deliver?: DeliverSteer) => {
      const steers = pending.splice(0)
      const out: TakenSteer[] = []
      for (const [index, steer] of steers.entries()) {
        if (deliver && !(await deliver(steer))) {
          pending.unshift(...steers.slice(index))
          break
        }
        settled.push(text(steer))
        out.push(steer)
      }
      return out
    }
    return { pending, settled, takeSteers }
  }

  /**
   * An AcpSession stand-in for Codex's adapter: `prompt` plays `onPrompt`,
   * `steer` answers from `outcomes` and runs `onSteer` after answering.
   */
  function codexSession(script: {
    onPrompt(
      ports: AcpSessionPorts,
      blocks: ContentBlock[]
    ): Promise<StopReason>
    outcomes?: SteerOutcome[]
    onSteer?(ports: AcpSessionPorts): Promise<void>
  }) {
    const prompts: ContentBlock[][] = []
    const steered: ContentBlock[][] = []
    const cancel = vi.fn()
    const factory: AcpSessionFactory = {
      async open(ports) {
        return {
          id: "codex_1",
          promptQueueing: false,
          steering: true,
          onClose() {},
          close() {},
          cancel,
          async prompt(blocks: ContentBlock[]) {
            prompts.push(blocks)
            return script.onPrompt(ports, blocks)
          },
          async steer(blocks: ContentBlock[]) {
            steered.push(blocks)
            const outcome = script.outcomes?.shift() ?? "injected"
            if (script.onSteer) setTimeout(() => void script.onSteer!(ports), 0)
            return outcome
          },
        } as unknown as AcpSession
      },
    }
    return { factory, prompts, steered, cancel }
  }
  const toolDone = (id: string): SessionUpdate => ({
    sessionUpdate: "tool_call",
    toolCallId: id,
    title: "Read a.ts",
    status: "completed",
  })
  const status = (type: string): SessionUpdate => ({
    sessionUpdate: "session_info_update",
    _meta: { codex: { threadStatus: { type } } },
  })
  const say = (t: string): SessionUpdate => ({
    sessionUpdate: "agent_message_chunk",
    content: textBlock(t),
  })

  it("sends a Steer through the steering request and settles it once the agent took it", async () => {
    const inbox = inboxOf(["skip the tests"])
    const codex = codexSession({
      async onPrompt(ports) {
        await ports.onUpdate(toolDone("call_1"))
        return "end_turn"
      },
    })
    const updates: EngineUpdate[] = []
    await new ExternalEngine({ sessionFactory: codex.factory }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      (u) => void updates.push(u),
      new AbortController().signal
    )
    expect(codex.steered).toEqual([[textBlock("skip the tests")]])
    expect(codex.prompts).toHaveLength(1)
    expect(inbox.settled).toEqual(["skip the tests"])
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
  })

  it("hands a failed Steer back to the inbox, and the next step boundary takes it", async () => {
    const inbox = inboxOf(["use v2", "and keep v1"])
    const codex = codexSession({
      outcomes: ["failed", "injected", "injected"],
      async onPrompt(ports) {
        await ports.onUpdate(toolDone("call_1"))
        expect(inbox.pending.map(text)).toEqual(["use v2", "and keep v1"])
        expect(inbox.settled).toEqual([])
        await ports.onUpdate(toolDone("call_2"))
        return "end_turn"
      },
    })
    await new ExternalEngine({ sessionFactory: codex.factory }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      () => {},
      new AbortController().signal
    )
    expect(codex.steered.map((b) => b.map(blockText).join(""))).toEqual([
      "use v2",
      "use v2",
      "and keep v1",
    ])
    expect(inbox.settled).toEqual(["use v2", "and keep v1"])
    expect(inbox.pending).toEqual([])
  })

  it("waits for a turn a Steer started after the running one ended", async () => {
    const inbox = inboxOf(["one more thing"])
    const codex = codexSession({
      outcomes: ["startedNewTurn"],
      async onPrompt(ports) {
        await ports.onUpdate(toolDone("call_1"))
        return "end_turn"
      },
      async onSteer(ports) {
        await ports.onUpdate(status("active"))
        await new Promise((resolve) => setTimeout(resolve, 10))
        await ports.onUpdate(say("Done that too."))
        await ports.onUpdate(status("idle"))
      },
    })
    const updates: EngineUpdate[] = []
    await new ExternalEngine({ sessionFactory: codex.factory }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      (u) => void updates.push(u),
      new AbortController().signal
    )
    expect(updates.at(-2)).toEqual({
      kind: "session_update",
      update: status("idle"),
    })
    expect(updates.filter((u) => u.kind === "done")).toEqual([
      { kind: "done", stopReason: "end_turn" },
    ])
    expect(updates).toContainEqual({
      kind: "session_update",
      update: say("Done that too."),
    })
  })

  // Codex sends the new turn's `active` in the same instant as its answer
  // (Mac probe); an update that beats the answer waits behind the step
  // boundary taking the Steer, so it still counts.
  it("counts the new turn's active status even when it arrives before the answer", async () => {
    const inbox = inboxOf(["one more thing"])
    let early: Promise<void> | undefined
    const codex = codexSession({
      outcomes: ["startedNewTurn"],
      async onPrompt(ports) {
        await ports.onUpdate(toolDone("call_1"))
        return "end_turn"
      },
    })
    const open = codex.factory.open.bind(codex.factory)
    codex.factory.open = async (ports, options) => {
      const session = await open(ports, options)
      const steer = session.steer.bind(session)
      session.steer = async (blocks) => {
        early = Promise.resolve(ports.onUpdate(status("active")))
        return steer(blocks)
      }
      setTimeout(() => {
        void early?.then(async () => {
          await ports.onUpdate(say("Done that too."))
          await ports.onUpdate(status("idle"))
        })
      }, 10)
      return session
    }
    const updates: EngineUpdate[] = []
    await new ExternalEngine({ sessionFactory: codex.factory }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      (u) => void updates.push(u),
      new AbortController().signal
    )
    expect(updates.at(-2)).toEqual({
      kind: "session_update",
      update: status("idle"),
    })
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
  })

  it("a stop during a turn a Steer started cancels it", async () => {
    const inbox = inboxOf(["one more thing"])
    const controller = new AbortController()
    const codex = codexSession({
      outcomes: ["startedNewTurn"],
      async onPrompt(ports) {
        await ports.onUpdate(toolDone("call_1"))
        return "end_turn"
      },
      async onSteer(ports) {
        await ports.onUpdate(status("active"))
        controller.abort()
      },
    })
    const updates: EngineUpdate[] = []
    await new ExternalEngine({ sessionFactory: codex.factory }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      (u) => void updates.push(u),
      controller.signal
    )
    expect(codex.cancel).toHaveBeenCalledTimes(1)
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "cancelled" })
  })

  it("over ACP: a failed request leaves the Steer for the next step, where the model reads it", async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const step = (id: string, extra: unknown[] = []) => ({
      chunks: [
        { type: "tool-input-start", id, toolName: "read_file" } as any,
        { type: "tool-call", toolCallId: id, toolName: "read_file", input: {} },
        ...extra,
        {
          type: "tool-result",
          toolCallId: id,
          toolName: "read_file",
          output: "x",
        },
      ] as any[],
      response: [],
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const inbox = inboxOf([])
    const sent: ModelMessage[][] = []
    const driver = steppedDriver(
      [
        [
          step("call_1", [
            () =>
              void inbox.pending.push({
                id: "s1",
                content: [textBlock("skip the tests")],
              }),
          ]),
          step("call_2"),
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chunks: [{ type: "text-delta", id: "t", text: "Done." } as any],
            response: [],
          },
        ],
      ],
      sent
    )
    await new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(driver, {
        steering: { failures: 1 },
      }),
    }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      () => {},
      new AbortController().signal
    )
    // Still pending after call_1 (failed), read before the step after call_2.
    expect(sent[1]!.at(-1)).not.toMatchObject({ content: "skip the tests" })
    expect(sent[2]!.at(-1)).toMatchObject({
      role: "user",
      content: "skip the tests",
    })
    expect(inbox.settled).toEqual(["skip the tests"])
  })

  it("sends Steers still waiting when the turn ends as one new prompt", async () => {
    const inbox = inboxOf([])
    const codex = codexSession({
      async onPrompt() {
        if (codex.prompts.length === 1)
          inbox.pending.push(
            { id: "s1", content: [textBlock("a")] },
            { id: "s2", content: [textBlock("b")] }
          )
        return "end_turn"
      },
    })
    await new ExternalEngine({ sessionFactory: codex.factory }).run(
      { ...turn, takeSteers: inbox.takeSteers },
      () => {},
      new AbortController().signal
    )
    expect(codex.prompts.slice(1)).toEqual([[textBlock("a"), textBlock("b")]])
    expect(codex.steered).toEqual([])
    expect(inbox.settled).toEqual(["a", "b"])
  })
})

describe("InProcessEngine — capability + cancellation", () => {
  it("captures prompt-cache usage from onEnd", async () => {
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        await config.onEnd?.({
          finishReason: "stop",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            inputTokenDetails: { cacheReadTokens: 90, cacheWriteTokens: 10 },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      },
    })
    const engine = new InProcessEngine(driver)
    await engine.run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "s",
        model: "anthropic:test",
        history: [],
      },
      () => {},
      new AbortController().signal
    )
    expect(engine.lastTurnUsage()).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 90,
      cacheWriteTokens: 10,
    })
  })

  it("reports an aborted run as a stop, not a failure", async () => {
    const updates: EngineUpdate[] = []
    const driver: StreamDriver = () => ({
      consumeStream: async () => {
        throw new Error("aborted")
      },
    })
    const controller = new AbortController()
    controller.abort()
    const engine = new InProcessEngine(driver)
    await engine.run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "s",
        model: "anthropic:test",
        history: [],
      },
      (u) => {
        updates.push(u)
      },
      controller.signal
    )
    expect(updates).toEqual([{ kind: "done", stopReason: "cancelled" }])
  })
})

describe("InProcessEngine — Coordinator tools (#1217, #1231)", () => {
  // A Coordinator tool runs as soon as it's called: its result, a refusal
  // included, completes the call, and a throw fails it.
  it("completes a Coordinator tool's call with what it returned", async () => {
    const updates: EngineUpdate[] = []
    const refusal =
      "\"Page title\" isn't in a GitHub repository, so it can't have a pull request."
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        const chunk = (c: unknown) =>
          config.onChunk?.({ chunk: c } as never) as Promise<void>
        await chunk({
          type: "tool-call",
          toolCallId: "t1",
          toolName: "open_pull_request",
          input: { workspace_id: "w1" },
        })
        await chunk({
          type: "tool-result",
          toolCallId: "t1",
          toolName: "open_pull_request",
          input: { workspace_id: "w1" },
          output: refusal,
        })
      },
    })
    await new InProcessEngine(driver).run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "s",
        model: "anthropic:test",
        history: [],
        tools: {
          open_pull_request: tool({
            inputSchema: jsonSchema<{ workspace_id: string }>({
              type: "object",
            }),
            execute: async () => refusal,
          }),
        },
      },
      (u) => {
        updates.push(u)
      },
      new AbortController().signal
    )
    // No card: the call runs and completes in the turn.
    expect(updates.some((u) => u.kind === "permission_request")).toBe(false)
    expect(updates).toContainEqual({
      kind: "session_update",
      update: expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: refusal } },
        ],
      }),
    })
  })

  it("still fails a Coordinator tool's call that throws (#1231)", async () => {
    const updates: EngineUpdate[] = []
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        const chunk = (c: unknown) =>
          config.onChunk?.({ chunk: c } as never) as Promise<void>
        await chunk({
          type: "tool-call",
          toolCallId: "t1",
          toolName: "stop_workspace",
          input: { workspace_id: "w9" },
        })
        await chunk({
          type: "tool-error",
          toolCallId: "t1",
          toolName: "stop_workspace",
          input: { workspace_id: "w9" },
          error: new Error("GitHub is down."),
        })
      },
    })
    await new InProcessEngine(driver).run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "s",
        model: "anthropic:test",
        history: [],
        tools: {
          stop_workspace: tool({
            inputSchema: jsonSchema<{ workspace_id: string }>({
              type: "object",
            }),
            execute: async (): Promise<string> => {
              throw new Error("GitHub is down.")
            },
          }),
        },
      },
      (u) => {
        updates.push(u)
      },
      new AbortController().signal
    )
    expect(updates).toContainEqual({
      kind: "session_update",
      update: expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "failed",
      }),
    })
  })
})
