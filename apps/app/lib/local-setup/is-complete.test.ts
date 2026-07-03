import { describe, expect, it } from "vitest"

import type { HarnessSetupStatus } from "@/lib/agent/harnesses/setup-status"
import {
  deriveGateStatus,
  githubSatisfied,
  harnessSatisfied,
  isLocalSetupComplete,
} from "@/lib/local-setup/is-complete"

/**
 * The shared release predicate (ADR 0016) is the single definition of "set up
 * enough to open the desktop app," called identically server-side (initial
 * paint) and client-side (poll). These table-driven cases pin its behaviour over
 * the status space — most sharply the harness half's `authenticated !== false`
 * tolerance: an indeterminate probe (`null`) passes, a *known* signed-out CLI
 * (`false`) blocks, and `true` passes.
 */

/** A Harness Setup row with the given install/auth facts (the fields the
 *  predicate reads — label/key/binary are cosmetic here). */
function row(
  installed: boolean,
  authenticated: boolean | null
): HarnessSetupStatus {
  return {
    key: "claude-code",
    label: "Claude Code",
    hostBinary: "claude",
    installed,
    authenticated,
  }
}

describe("harnessSatisfied", () => {
  const cases: [string, HarnessSetupStatus[], boolean][] = [
    ["no harnesses at all", [], false],
    ["one not-installed row", [row(false, null)], false],
    ["installed + authenticated === true", [row(true, true)], true],
    [
      "installed + authenticated === null (indeterminate probe, tolerated)",
      [row(true, null)],
      true,
    ],
    [
      "installed + authenticated === false (known signed-out, blocks)",
      [row(true, false)],
      false,
    ],
    [
      "a known signed-out row plus a tolerated null row — some passes",
      [row(true, false), row(true, null)],
      true,
    ],
    [
      "authed but not installed — presence is still required",
      [row(false, true)],
      false,
    ],
  ]

  for (const [name, harnesses, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(harnessSatisfied(harnesses)).toBe(expected)
    })
  }
})

describe("githubSatisfied", () => {
  it("null tokenSource → false (a token never resolved)", () => {
    expect(githubSatisfied({ tokenSource: null })).toBe(false)
  })

  it("a gh-resolved token → true", () => {
    expect(githubSatisfied({ tokenSource: "gh" })).toBe(true)
  })

  it("a device-flow token → true", () => {
    expect(githubSatisfied({ tokenSource: "device" })).toBe(true)
  })
})

describe("isLocalSetupComplete", () => {
  // The full truth table over the three boolean facts. The harness half is a
  // hard requirement; the GitHub half is satisfied by a live connection OR a
  // persisted skip.
  const cases: [boolean, boolean, boolean, boolean][] = [
    // harnessSatisfied, githubSatisfied, githubSkipped → complete
    [false, false, false, false],
    [false, true, true, false], // no harness → never complete
    [true, false, false, false], // harness only, github unmet + not skipped
    [true, true, false, true], // harness + live github connection
    [true, false, true, true], // harness + github skipped (no-auth floor)
    [true, true, true, true],
  ]

  for (const [h, g, skip, expected] of cases) {
    it(`harness=${h} github=${g} skipped=${skip} → ${expected}`, () => {
      expect(
        isLocalSetupComplete({
          harnessSatisfied: h,
          githubSatisfied: g,
          githubSkipped: skip,
        })
      ).toBe(expected)
    })
  }
})

describe("deriveGateStatus", () => {
  it("returns exactly the two release booleans", () => {
    const status = deriveGateStatus({
      harnesses: [row(true, true)],
      github: { tokenSource: "gh" },
    })
    expect(status).toEqual({ harnessSatisfied: true, githubSatisfied: true })
  })

  it("folds the raw shapes down to booleans and leaks no credential fields", () => {
    // A live GitHub status carries a handle, device-token presence, etc. Only
    // the resolved-token *source* is read, and only the two booleans come out —
    // no raw credential shape crosses to the client.
    const github = {
      tokenSource: "gh" as const,
      ghHandle: "octocat",
      hasDeviceToken: true,
      deviceFlowConfigured: true,
    }
    const status = deriveGateStatus({
      harnesses: [row(true, false)],
      github,
    })

    expect(Object.keys(status).sort()).toEqual([
      "githubSatisfied",
      "harnessSatisfied",
    ])
    expect(status).toEqual({ harnessSatisfied: false, githubSatisfied: true })
  })
})
