import { afterEach, describe, expect, it, vi } from "vitest"

// `selectEngine`/`inProcessEngine` reach the in-process engine, which binds to
// the model providers at import time; stub the resolution that would otherwise
// demand real API keys (mirrors contract.test.ts).
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

import {
  ENGINE_ENV_VAR,
  engineChoiceFromEnv,
  selectEngine,
} from "./engine-select"
import { AcpEngine } from "./acp-engine"
import { inProcessEngine } from "./in-process-engine"

/**
 * Engine selection is minimal and explicit (ADR 0006, acceptance criterion 2):
 * one per-deployment env var, default `in-process`, no per-Chat-Session column.
 */
describe("engineChoiceFromEnv", () => {
  it("defaults to in-process when AGENT_ENGINE is unset", () => {
    expect(engineChoiceFromEnv({})).toBe("in-process")
  })

  it("selects acp on the explicit value", () => {
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "acp" })).toBe("acp")
  })

  it("treats an unrecognised value as the default — never a silent swap", () => {
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "ACP" })).toBe("in-process")
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "" })).toBe("in-process")
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "in-process" })).toBe(
      "in-process"
    )
  })
})

describe("selectEngine", () => {
  const original = process.env[ENGINE_ENV_VAR]
  afterEach(() => {
    if (original === undefined) delete process.env[ENGINE_ENV_VAR]
    else process.env[ENGINE_ENV_VAR] = original
  })

  it("returns the in-process engine by default", () => {
    delete process.env[ENGINE_ENV_VAR]
    expect(selectEngine()).toBe(inProcessEngine)
  })

  it("builds an ACP engine from the injected config when AGENT_ENGINE=acp", () => {
    process.env[ENGINE_ENV_VAR] = "acp"
    const engine = selectEngine({
      acp: {
        sessionFactory: {
          open: async () => {
            throw new Error("session factory unused in this test")
          },
        },
      },
    })
    expect(engine).toBeInstanceOf(AcpEngine)
    expect(engine.id).toBe("acp")
  })

  it("throws when AGENT_ENGINE=acp but no transport is configured, rather than silently falling back", () => {
    process.env[ENGINE_ENV_VAR] = "acp"
    expect(() => selectEngine()).toThrow(/no ACP session factory/)
  })
})
