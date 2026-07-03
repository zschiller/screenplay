// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  githubSkipCookieName,
  parseGitHubSkip,
  writeGitHubSkip,
} from "./github-skip"

/**
 * The GitHub-skip cookie helper (ADR 0016) is the one persisted knob of the
 * first-run gate: written client-side when the user clicks "Skip for now" and
 * parsed server-side by the root layout so a skipped, harness-satisfied user is
 * never re-blocked. Mirrors `home-view-prefs.test.ts`: a defensive parse over
 * malformed/missing values plus the client write shape.
 */

describe("parseGitHubSkip", () => {
  it("returns false for a missing cookie", () => {
    expect(parseGitHubSkip(undefined)).toBe(false)
  })

  it("returns true only for the exact sentinel value", () => {
    expect(parseGitHubSkip("1")).toBe(true)
  })

  it("returns false for empty / malformed / hand-edited values", () => {
    // Only the exact sentinel counts as skipped — anything else is the safe
    // default (keep offering GitHub) rather than trusting a garbage cookie.
    for (const raw of ["", "0", "true", "yes", "11", " 1", "1 ", "skip"]) {
      expect(parseGitHubSkip(raw)).toBe(false)
    }
  })
})

describe("writeGitHubSkip", () => {
  // jsdom gives a real, mutable `document.cookie`. Clear the cookie between
  // cases so a prior write can't leak into the next assertion.
  afterEach(() => {
    document.cookie = `${githubSkipCookieName()}=; path=/; max-age=0`
  })

  it("writes the skip sentinel under the shared cookie name, round-tripping through parse", () => {
    expect(document.cookie).not.toContain(githubSkipCookieName())

    writeGitHubSkip()

    // jsdom's document.cookie exposes `name=value` (no attributes), which is
    // exactly what the server reads via `cookieStore.get(name)?.value`.
    expect(document.cookie).toContain(`${githubSkipCookieName()}=1`)

    const raw = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${githubSkipCookieName()}=`))
      ?.split("=")[1]
    expect(parseGitHubSkip(raw)).toBe(true)
  })
})
