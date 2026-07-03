/**
 * A reusable host-tool **setup step** (ADR 0014): the pure state machine behind
 * a Settings surface that installs and/or authenticates a host CLI in an inline
 * terminal, then re-detects. `gh` is its first instance; the deferred harness
 * detection/setup Settings surface plugs in as a sibling.
 *
 * The machine is deliberately tool- and transport-agnostic. It is driven by only
 * two kinds of input: a **detection result** (what a probe found) and a
 * **terminal-exit** signal (the inline PTY closed). A thin React wrapper runs the
 * actual detection and mounts the terminal; every decision the wrapper needs
 * lives here, so it stays unit-testable without a DOM, a process, or a socket —
 * the same pure-fold shape as `device-flow.ts`.
 */

/** What a detection probe found about the host tool's install/auth state. */
export type DetectionResult =
  | "not-installed"
  | "installed-not-authed"
  | "authed"

/**
 * The step's phase.
 *
 * `unknown` means "no detection has resolved yet". It is both the initial phase
 * and the phase re-entered after a terminal exits — both of which prompt the
 * wrapper to (re-)run detection, whose result then decides the concrete phase.
 * `working` means the inline terminal is live (an install or sign-in running).
 */
export type SetupPhase =
  | "unknown"
  | "not-installed"
  | "installed-not-authed"
  | "authed"
  | "working"

export interface SetupState {
  phase: SetupPhase
}

export const initialSetupState: SetupState = { phase: "unknown" }

export type SetupEvent =
  /**
   * A detection probe resolved. Lands the machine in the matching phase — the
   * first detection out of `unknown` and the re-detection after a terminal exit
   * both flow through here (a finished sign-in → `authed`; a failed install →
   * back to `not-installed`).
   */
  | { type: "detected"; result: DetectionResult }
  /** An inline-terminal action (install / sign-in) started. */
  | { type: "run-started" }
  /**
   * The inline terminal's PTY exited — the completion signal. Returns to
   * `unknown` so the wrapper re-detects rather than trusting the pre-run phase.
   */
  | { type: "terminal-exited" }

const DETECTED_PHASE: Record<DetectionResult, SetupPhase> = {
  "not-installed": "not-installed",
  "installed-not-authed": "installed-not-authed",
  authed: "authed",
}

/**
 * Whether a terminal action can start from `phase`. The two "needs a step"
 * phases, plus `authed` — which re-runs sign-in to refresh a lapsed login (the
 * only action a connected `gh` offers).
 */
function canRun(phase: SetupPhase): boolean {
  return (
    phase === "not-installed" ||
    phase === "installed-not-authed" ||
    phase === "authed"
  )
}

export function setupReducer(state: SetupState, event: SetupEvent): SetupState {
  switch (event.type) {
    case "detected":
      // A detection result arriving while the terminal is live is stale — ignore
      // it so a late probe can't yank the machine out of `working` mid-session.
      if (state.phase === "working") return state
      return { phase: DETECTED_PHASE[event.result] }
    case "run-started":
      return canRun(state.phase) ? { phase: "working" } : state
    case "terminal-exited":
      return state.phase === "working" ? { phase: "unknown" } : state
  }
}
