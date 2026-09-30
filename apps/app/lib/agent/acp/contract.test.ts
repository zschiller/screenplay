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
import { planFromPermissionRequest } from "./schema"
import { withPlanGate } from "../plan-gate"
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import { ExternalEngine } from "./acp-engine"
import {
  acpSessionFactoryFromDriver,
  contractFor,
  steeringContractFor,
} from "./engine-contract"
import { supportsSteering } from "./engine-seam"

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

// The external Engine can't steer until the Harness's prompt queueing is wired
// (#1191), so Turn Launch answers "not steerable" and the client queues.
describe("ExternalEngine — steering", () => {
  it("is not a steering Engine yet", () => {
    const engine = new ExternalEngine({
      sessionFactory: acpSessionFactoryFromDriver(() => ({
        consumeStream: async () => {},
      })),
    })
    expect(supportsSteering(engine)).toBe(false)
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

  it("records a refused gate's call as failed, with the reason, and raises no card (#901)", async () => {
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
          status: "failed",
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
})
