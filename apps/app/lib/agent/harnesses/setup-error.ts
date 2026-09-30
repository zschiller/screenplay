import type { HarnessSetupActionKind, HarnessSetupRow } from "./setup"

/**
 * The inline line under a coding agent's Install or Sign in when it didn't
 * work, so a failed run never just drops back to the button it started from.
 * Shared by Settings' Coding agents and the setup gate's agent step.
 */

/** The run couldn't start (the server couldn't resolve what to run). */
export function setupStartError(kind: HarnessSetupActionKind): string {
  return kind === "install"
    ? "Couldn't start the install. Try again."
    : "Couldn't start sign-in. Try again."
}

/**
 * The terminal exited: `null` when the agent is now signed in, else what's
 * still missing, read from the fresh row (`undefined` when the re-check
 * itself failed).
 */
export function setupRunError(
  kind: HarnessSetupActionKind,
  label: string,
  row: HarnessSetupRow | undefined
): string | null {
  if (!row) return `Couldn't check ${label}. Try again.`
  if (row.connected) return null
  if (kind === "install" && !row.installed) {
    return "The install didn't finish. Try again."
  }
  return "Sign-in didn't finish. Try again."
}
