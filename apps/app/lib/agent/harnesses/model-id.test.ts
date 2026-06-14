import { describe, expect, it } from "vitest"

import { HARNESSES } from "./index"
import {
  decodeHarnessModelId,
  encodeHarnessModelId,
  isValidHarnessKey,
} from "./model-id"

/**
 * The model-id codec is the wire format that lets a chat remember not just which
 * Harness it runs but which model of that Harness, carried verbatim on
 * `agent_chat.model` with no parallel storage (#524). These tests pin it as
 * external behavior — round-trip, bare-key backward compat, the colon-free key
 * invariant, and `provider:` ids never matching — in the style of the harness
 * selection / engine-select codec tests.
 */
describe("encode/decode harness model id (round-trip)", () => {
  it("round-trips key + modelId, splitting on the first colon after the prefix", () => {
    const id = encodeHarnessModelId("claude-code", "sonnet")
    expect(id).toBe("harness:claude-code:sonnet")
    expect(decodeHarnessModelId(id)).toEqual({
      key: "claude-code",
      modelId: "sonnet",
    })
  })

  it("keeps a modelId that itself contains colons intact (splits only once)", () => {
    const id = encodeHarnessModelId("codex", "openrouter:anthropic/claude:beta")
    expect(id).toBe("harness:codex:openrouter:anthropic/claude:beta")
    expect(decodeHarnessModelId(id)).toEqual({
      key: "codex",
      modelId: "openrouter:anthropic/claude:beta",
    })
  })
})

describe("decodeHarnessModelId — bare key (backward compatibility)", () => {
  it('parses a bare `harness:<key>` to { key, modelId: undefined } ("harness default")', () => {
    const decoded = decodeHarnessModelId("harness:claude-code")
    expect(decoded).toEqual({ key: "claude-code" })
    expect(decoded?.modelId).toBeUndefined()
  })

  it("encodes a bare key (no model) back to the pre-codec `harness:<key>` form", () => {
    expect(encodeHarnessModelId("claude-code")).toBe("harness:claude-code")
  })

  it("collapses a trailing colon with no model to the bare-key meaning", () => {
    expect(decodeHarnessModelId("harness:claude-code:")).toEqual({
      key: "claude-code",
    })
  })

  it("trims surrounding whitespace before parsing", () => {
    expect(decodeHarnessModelId("  harness:codex  ")).toEqual({ key: "codex" })
  })
})

describe("decodeHarnessModelId — non-harness ids yield null", () => {
  it("never parses a `provider:<model>` id as a harness id", () => {
    expect(decodeHarnessModelId("anthropic:claude-sonnet-4-6")).toBeNull()
    expect(decodeHarnessModelId("openai:gpt-4o")).toBeNull()
  })

  it("yields null for a missing, empty, or whitespace id", () => {
    expect(decodeHarnessModelId(undefined)).toBeNull()
    expect(decodeHarnessModelId(null)).toBeNull()
    expect(decodeHarnessModelId("")).toBeNull()
    expect(decodeHarnessModelId("   ")).toBeNull()
  })

  it("yields null for a `harness:` prefix with no key", () => {
    expect(decodeHarnessModelId("harness:")).toBeNull()
    expect(decodeHarnessModelId("harness:   ")).toBeNull()
    expect(decodeHarnessModelId("harness::sonnet")).toBeNull()
  })
})

describe("isValidHarnessKey — the colon-free (and comma-free) key invariant", () => {
  it("accepts a plain catalog key", () => {
    expect(isValidHarnessKey("claude-code")).toBe(true)
    expect(isValidHarnessKey("codex")).toBe(true)
  })

  it("rejects a key containing a colon (would break the model-id codec)", () => {
    expect(isValidHarnessKey("claude:code")).toBe(false)
  })

  it("rejects a key containing a comma (would break SANDBOX_HARNESSES)", () => {
    expect(isValidHarnessKey("claude,code")).toBe(false)
  })

  it("rejects an empty key", () => {
    expect(isValidHarnessKey("")).toBe(false)
  })

  it("encode throws on a key that breaks the invariant rather than emitting an undecodable id", () => {
    expect(() => encodeHarnessModelId("claude:code")).toThrow(/colon/)
    expect(() => encodeHarnessModelId("claude,code")).toThrow(/comma/)
    expect(() => encodeHarnessModelId("")).toThrow()
  })

  it("every shipped harness key honors the invariant", () => {
    for (const harness of HARNESSES) {
      expect(isValidHarnessKey(harness.key)).toBe(true)
    }
  })
})
