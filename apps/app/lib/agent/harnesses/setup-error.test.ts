import { describe, expect, it } from "vitest"

import type { HarnessSetupRow } from "./setup"
import { setupRunError, setupStartError } from "./setup-error"

const row = (patch: Partial<HarnessSetupRow>) =>
  ({ connected: false, installed: false, ...patch }) as HarnessSetupRow

describe("setupStartError", () => {
  it("names the action that couldn’t start", () => {
    expect(setupStartError("install")).toBe(
      "Couldn’t start the install. Try again."
    )
    expect(setupStartError("auth")).toBe("Couldn’t start sign-in. Try again.")
  })
})

describe("setupRunError", () => {
  it("is null once the agent is signed in", () => {
    expect(
      setupRunError("install", "Claude Code", row({ connected: true }))
    ).toBeNull()
  })

  it("says the install didn’t finish when the binary is still missing", () => {
    expect(setupRunError("install", "Claude Code", row({}))).toBe(
      "The install didn’t finish. Try again."
    )
  })

  it("says sign-in didn’t finish when installed but signed out", () => {
    expect(
      setupRunError("install", "Claude Code", row({ installed: true }))
    ).toBe("Sign-in didn’t finish. Try again.")
    expect(setupRunError("auth", "Codex", row({ installed: true }))).toBe(
      "Sign-in didn’t finish. Try again."
    )
  })

  it("says the re-check failed when there’s no fresh row", () => {
    expect(setupRunError("auth", "Codex", undefined)).toBe(
      "Couldn’t check Codex. Try again."
    )
  })
})
