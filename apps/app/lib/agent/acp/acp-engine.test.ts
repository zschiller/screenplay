import { describe, expect, it, vi } from "vitest"

// `inProcessEngine` (imported for the capability contrast) binds to the model
// providers at import time; stub the resolution that would otherwise demand real
// API keys (mirrors contract.test.ts).
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

import { ExternalEngine } from "./acp-engine"
import { inProcessEngine } from "./in-process-engine"
import { supportsUsageReporting } from "./engine-seam"

/**
 * Graceful capability degradation (ADR 0003 / ADR 0006, acceptance criterion 3):
 * a generic ACP agent may never surface prompt-cache usage, so the ACP engine
 * omits the {@link import("./engine-seam").UsageReportingEngine} capability
 * entirely. The `supports*` type guard narrows it out and the caller takes the
 * no-usage branch — never a half-implemented method on the core.
 */
describe("ExternalEngine — graceful capability degradation", () => {
  const engine = new ExternalEngine({
    sessionFactory: {
      open: async () => {
        throw new Error("session factory unused in this test")
      },
    },
  })

  it("identifies itself as the external engine", () => {
    expect(engine.id).toBe("external")
  })

  it("does not advertise usage reporting, so the type guard narrows it out", () => {
    expect(supportsUsageReporting(engine)).toBe(false)
  })

  it("contrasts with the in-process engine, which does report usage", () => {
    expect(supportsUsageReporting(inProcessEngine)).toBe(true)
  })

  it("a usage-reading caller takes the no-usage branch for the ACP engine", () => {
    // The exact shape every caller uses: narrow first, read only if narrowed.
    const usage = supportsUsageReporting(engine) ? engine.lastTurnUsage() : null
    expect(usage).toBeNull()
  })
})
