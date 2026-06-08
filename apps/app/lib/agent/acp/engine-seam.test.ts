import { describe, expect, it } from "vitest"
import {
  supportsUsageReporting,
  type Engine,
  type EngineTurn,
  type EngineUpdateSink,
  type UsageReportingEngine,
} from "./engine-seam"

const turn = {} as EngineTurn
const sink: EngineUpdateSink = () => {}

/** A portable-core engine with no capabilities. */
const plainEngine: Engine = {
  id: "plain",
  async run() {},
}

/** An engine that honors the prompt-cache usage capability. */
const usageEngine: UsageReportingEngine = {
  id: "usage",
  reportsUsage: true,
  async run() {},
  lastTurnUsage: () => ({ inputTokens: 10, cacheReadTokens: 8 }),
}

describe("supportsUsageReporting (capability type guard)", () => {
  it("narrows an engine that reports usage", () => {
    const e: Engine = usageEngine
    expect(supportsUsageReporting(e)).toBe(true)
    if (supportsUsageReporting(e)) {
      // Narrowed: the capability method is reachable only inside the guard,
      // mirroring supportsHibernation (ADR 0003).
      expect(e.lastTurnUsage()?.cacheReadTokens).toBe(8)
    }
  })

  it("does not narrow a portable-core-only engine", () => {
    expect(supportsUsageReporting(plainEngine)).toBe(false)
  })

  // Type-level guard: the core has no usage method, so a caller can only reach
  // usage after narrowing. This compiles iff `lastTurnUsage` is gated.
  it("keeps usage off the portable core", () => {
    const e: Engine = plainEngine
    // @ts-expect-error lastTurnUsage is not on the portable core
    void e.lastTurnUsage
    void turn
    void sink
    expect(true).toBe(true)
  })
})
