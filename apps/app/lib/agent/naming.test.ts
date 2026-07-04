import { describe, expect, it } from "vitest"

import { deriveFallbackName } from "@/lib/agent/fallback-name"
import { generateChatNames } from "@/lib/agent/naming"
import type { runNamingModel } from "@/lib/agent/naming-transport"

/**
 * `generateChatNames` wraps the per-backend naming transport (#674): on a model
 * result it runs the two-line output through the existing parse + sanitize +
 * length bounds; on a `null` result (no model reachable / a failed call) it
 * falls back to the improved deterministic slug (#675). These tests inject a
 * fake transport so both paths are exercised without a subprocess or a hosted
 * provider — the same result a successful desktop `runHostModel` would flow
 * through. Prior art: the existing naming/fallback parsing coverage.
 */

/** A transport stub that always returns `text` (or `null`), recording its input. */
function transport(text: string | null): typeof runNamingModel {
  return async () => text
}

describe("generateChatNames", () => {
  it("parses a two-line model result into a sanitized branch + label", async () => {
    const result = await generateChatNames(
      { message: "please fix the flaky login test", shouldNameBranch: true },
      { runModel: transport("Fix Login Test\nFix Login Test") }
    )
    // Line 1 is lowercased + hyphen-sanitized; line 2 is the label verbatim.
    expect(result).toEqual({
      branch: "fix-login-test",
      chatLabel: "Fix Login Test",
    })
  })

  it("falls back to the deterministic slug when the model is unreachable (null)", async () => {
    const message = "please fix the flaky login test"
    const fallback = deriveFallbackName(message)

    const result = await generateChatNames(
      { message, shouldNameBranch: true },
      { runModel: transport(null) }
    )

    expect(result).toEqual({
      branch: fallback.branch,
      chatLabel: fallback.label,
    })
    // The improved slug, not the raw truncated prompt (#675).
    expect(result.branch).toMatch(/^fix-flaky-login-test-/)
    expect(result.chatLabel).toBe("Fix Flaky Login Test")
  })

  it("keeps the branch blank on the null path when a branch wasn't wanted", async () => {
    const message = "please fix the flaky login test"
    const result = await generateChatNames(
      { message, shouldNameBranch: false },
      { runModel: transport(null) }
    )
    expect(result.branch).toBe("")
    expect(result.chatLabel).toBe(deriveFallbackName(message).label)
  })

  it("names only the label when a branch wasn't wanted", async () => {
    const result = await generateChatNames(
      { message: "add dark mode", shouldNameBranch: false },
      { runModel: transport("Add Dark Mode") }
    )
    expect(result).toEqual({ branch: "", chatLabel: "Add Dark Mode" })
  })

  it("drops an out-of-bounds branch and falls back for an unusable label", async () => {
    const message = "tweak the thing"
    // Branch line too short (< 3 chars) → dropped to ""; label empty → fallback.
    const result = await generateChatNames(
      { message, shouldNameBranch: true },
      { runModel: transport("ab\n") }
    )
    expect(result.branch).toBe("")
    expect(result.chatLabel).toBe(deriveFallbackName(message).label)
  })
})
