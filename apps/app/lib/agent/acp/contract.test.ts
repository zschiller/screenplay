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

import { jsonSchema, tool } from "ai"
import type { EngineUpdate } from "./engine-seam"
import { planFromPermissionRequest, textBlock } from "./schema"
import { withPlanGate } from "../plan-gate"
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import { ExternalEngine } from "./acp-engine"
import type { AcpSessionPorts } from "./session"
import {
  acpSessionFactoryFromDriver,
  contractFor,
  steeringContractFor,
  steppedDriver,
} from "./engine-contract"

contractFor("in-process", (driver) => new InProcessEngine(driver))
steeringContractFor("in-process", (driver) => new InProcessEngine(driver))

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
      await config.onFinish?.({ finishReason: "stop" } as any)
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

  it("a stop ends an agent that keeps working past the cancel, showing none of it", async () => {
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
    expect(updates).toEqual([{ kind: "done", stopReason: "cancelled" }])
  })

  it("a turn that ends on its own leaves the agent be", async () => {
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
    expect(close).not.toHaveBeenCalled()
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

describe("InProcessEngine — capability + cancellation", () => {
  it("captures prompt-cache usage from onFinish", async () => {
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        await config.onFinish?.({
          finishReason: "stop",
          totalUsage: {
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

describe("InProcessEngine — plan-gated tools (#898)", () => {
  it("halts a plan-gated tool's call on the plan gate, with its plan and input", async () => {
    const updates: EngineUpdate[] = []
    const gated = withPlanGate(
      tool({ inputSchema: jsonSchema<{ n: number }>({ type: "object" }) }),
      async (input) => ({
        plan: `Create ${(input as { n: number }).n}`,
        input: { gate: "create_things", n: (input as { n: number }).n },
      })
    )
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        const chunk = (c: unknown) =>
          config.onChunk?.({ chunk: c } as never) as Promise<void>
        await chunk({ type: "tool-input-start", id: "t1", toolName: "gated" })
        await chunk({
          type: "tool-call",
          toolCallId: "t1",
          toolName: "gated",
          input: { n: 2 },
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
        tools: { gated },
      },
      (u) => {
        updates.push(u)
      },
      new AbortController().signal
    )
    // No tool row for the call: only the gate, which the consumer pauses on.
    expect(updates).toHaveLength(1)
    const [update] = updates
    if (update?.kind !== "permission_request") throw new Error("no gate")
    expect(planFromPermissionRequest(update.request)).toEqual({
      toolCallId: "t1",
      plan: "Create 2",
      input: { gate: "create_things", n: 2, plan: "Create 2" },
    })
  })

  it("records a refused gate's call as completed, with the reason, and raises no card (#901, #1231)", async () => {
    const updates: EngineUpdate[] = []
    const gated = withPlanGate(
      tool({ inputSchema: jsonSchema<{ id: string }>({ type: "object" }) }),
      async () => ({ refusal: "No Workspace has the id w9." })
    )
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        const chunk = (c: unknown) =>
          config.onChunk?.({ chunk: c } as never) as Promise<void>
        await chunk({ type: "tool-input-start", id: "t1", toolName: "gated" })
        await chunk({
          type: "tool-call",
          toolCallId: "t1",
          toolName: "gated",
          input: { id: "w9" },
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
        tools: { gated },
      },
      (u) => {
        updates.push(u)
      },
      new AbortController().signal
    )
    expect(updates).toEqual([
      {
        kind: "session_update",
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "gated",
          status: "completed",
          rawInput: { id: "w9" },
          content: [
            {
              type: "content",
              content: { type: "text", text: "No Workspace has the id w9." },
            },
          ],
        }),
      },
    ])
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
