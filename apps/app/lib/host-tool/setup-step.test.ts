import { describe, expect, it } from "vitest"

import {
  initialSetupState,
  setupReducer,
  type SetupEvent,
  type SetupState,
} from "@/lib/host-tool/setup-step"

/** Fold a sequence of events over the reducer from a start state. */
function run(
  events: SetupEvent[],
  from: SetupState = initialSetupState
): SetupState {
  return events.reduce(setupReducer, from)
}

describe("setup-step reducer", () => {
  it("starts unknown", () => {
    expect(initialSetupState).toEqual({ phase: "unknown" })
  })

  it("each detection result lands in its matching phase", () => {
    expect(
      setupReducer(initialSetupState, {
        type: "detected",
        result: "not-installed",
      })
    ).toEqual({ phase: "not-installed" })
    expect(
      setupReducer(initialSetupState, {
        type: "detected",
        result: "installed-not-authed",
      })
    ).toEqual({ phase: "installed-not-authed" })
    expect(
      setupReducer(initialSetupState, { type: "detected", result: "authed" })
    ).toEqual({ phase: "authed" })
  })

  it("run-started moves a needs-a-step phase to working", () => {
    expect(
      setupReducer({ phase: "not-installed" }, { type: "run-started" })
    ).toEqual({ phase: "working" })
    expect(
      setupReducer({ phase: "installed-not-authed" }, { type: "run-started" })
    ).toEqual({ phase: "working" })
  })

  it("run-started from authed re-runs sign-in (refresh a lapsed login)", () => {
    expect(setupReducer({ phase: "authed" }, { type: "run-started" })).toEqual({
      phase: "working",
    })
  })

  it("run-started is a no-op while unknown or already working", () => {
    expect(setupReducer({ phase: "unknown" }, { type: "run-started" })).toEqual(
      { phase: "unknown" }
    )
    expect(setupReducer({ phase: "working" }, { type: "run-started" })).toEqual(
      { phase: "working" }
    )
  })

  it("terminal-exited returns to unknown so the wrapper re-detects", () => {
    expect(
      setupReducer({ phase: "working" }, { type: "terminal-exited" })
    ).toEqual({ phase: "unknown" })
  })

  it("terminal-exited outside working is ignored", () => {
    for (const phase of [
      "unknown",
      "not-installed",
      "installed-not-authed",
      "authed",
    ] as const) {
      expect(setupReducer({ phase }, { type: "terminal-exited" })).toEqual({
        phase,
      })
    }
  })

  it("ignores a stale detection that arrives while working", () => {
    expect(
      setupReducer({ phase: "working" }, { type: "detected", result: "authed" })
    ).toEqual({ phase: "working" })
  })

  it("walks install → sign-in → connected across two terminal runs", () => {
    // not-installed → (install+auth run) → working → exit → re-detect finds gh
    // installed but the login didn't finish → sign-in run → working → exit →
    // re-detect finds it authenticated.
    const afterInstall = run([
      { type: "detected", result: "not-installed" },
      { type: "run-started" },
      { type: "terminal-exited" },
      { type: "detected", result: "installed-not-authed" },
    ])
    expect(afterInstall).toEqual({ phase: "installed-not-authed" })

    const afterAuth = run(
      [
        { type: "run-started" },
        { type: "terminal-exited" },
        { type: "detected", result: "authed" },
      ],
      afterInstall
    )
    expect(afterAuth).toEqual({ phase: "authed" })
  })

  it("a failed install stays not-installed after re-detection", () => {
    const afterFailedInstall = run([
      { type: "detected", result: "not-installed" },
      { type: "run-started" },
      { type: "terminal-exited" },
      { type: "detected", result: "not-installed" },
    ])
    expect(afterFailedInstall).toEqual({ phase: "not-installed" })
  })
})
