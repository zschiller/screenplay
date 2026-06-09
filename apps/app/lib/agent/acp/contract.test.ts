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

import type { EngineUpdate } from "./engine-seam"
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import { ExternalEngine } from "./acp-engine"
import { acpSessionFactoryFromDriver, contractFor } from "./engine-contract"

contractFor("in-process", (driver) => new InProcessEngine(driver))

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
    expect(updates).toEqual([{ kind: "error", message: "Stopped by user" }])
  })
})
