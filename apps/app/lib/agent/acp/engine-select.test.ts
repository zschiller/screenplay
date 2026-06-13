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
  harnessKeyFromModelId,
  selectEngine,
} from "./engine-select"
import { ExternalEngine } from "./acp-engine"
import { inProcessEngine } from "./in-process-engine"

/**
 * Engine selection is minimal and explicit (ADR 0006, acceptance criterion 2):
 * one per-deployment env var, default `in-process`, no per-Chat-Session column.
 */
describe("engineChoiceFromEnv", () => {
  it("defaults to in-process when AGENT_ENGINE is unset", () => {
    expect(engineChoiceFromEnv({})).toBe("in-process")
  })

  it("selects external on the explicit value", () => {
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "external" })).toBe("external")
  })

  it("treats an unrecognised value as the default — never a silent swap", () => {
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "External" })).toBe("in-process")
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "" })).toBe("in-process")
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "in-process" })).toBe(
      "in-process"
    )
  })
})

/**
 * The chat's stored `model` id picks the external engine's *adapter*, never the
 * *engine* (#479, ADR 0006). This parser is the read half: a `harness:` id names
 * the adapter; a `provider:` id (or none) does not, so the engine choice stays a
 * build-time per-deployment decision.
 */
describe("harnessKeyFromModelId", () => {
  it("reads the harness key from a `harness:` id", () => {
    expect(harnessKeyFromModelId("harness:claude-code")).toBe("claude-code")
    expect(harnessKeyFromModelId("harness:codex")).toBe("codex")
  })

  it("returns null for a `provider:` id — it never selects the external engine", () => {
    expect(harnessKeyFromModelId("anthropic:claude-sonnet-4-6")).toBeNull()
    expect(harnessKeyFromModelId("openai:gpt-4o")).toBeNull()
  })

  it("returns null for a missing or empty id (caller falls back to the env default)", () => {
    expect(harnessKeyFromModelId(undefined)).toBeNull()
    expect(harnessKeyFromModelId(null)).toBeNull()
    expect(harnessKeyFromModelId("")).toBeNull()
    expect(harnessKeyFromModelId("   ")).toBeNull()
  })

  it("returns null for a `harness:` prefix with no key", () => {
    expect(harnessKeyFromModelId("harness:")).toBeNull()
    expect(harnessKeyFromModelId("harness:   ")).toBeNull()
  })

  it("trims surrounding whitespace before parsing", () => {
    expect(harnessKeyFromModelId("  harness:codex  ")).toBe("codex")
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

  it("builds an external engine from the injected config when AGENT_ENGINE=external", () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = selectEngine({
      external: {
        sessionFactory: {
          open: async () => {
            throw new Error("session factory unused in this test")
          },
        },
      },
    })
    expect(engine).toBeInstanceOf(ExternalEngine)
    expect(engine.id).toBe("external")
  })

  it("throws when AGENT_ENGINE=external but no transport is configured, rather than silently falling back", () => {
    process.env[ENGINE_ENV_VAR] = "external"
    expect(() => selectEngine()).toThrow(/no ACP session factory/)
  })
})
