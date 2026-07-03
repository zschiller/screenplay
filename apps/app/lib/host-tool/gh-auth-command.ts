/**
 * The inline-terminal command that signs the host `gh` CLI in to GitHub
 * (ADR 0014). Pure — it only builds the argv, so it is unit-testable without a
 * process, and the host-session terminal transport runs it verbatim in a PTY.
 *
 * `gh auth login --web` runs GitHub's browser flow and prints a one-time code to
 * the terminal (the visible-terminal UX this feature is about, rather than a
 * spinner that might silently fail). `--git-protocol https` matches how the app
 * clones, and `--scopes repo` requests exactly the scope the device flow does,
 * so both connect paths grant the same GitHub API access.
 */

/** The OAuth scope requested for the connection — identical to the device flow. */
export const GH_AUTH_SCOPE = "repo"

/**
 * The argv for `gh auth login`, run directly (no shell wrapper) in the inline
 * host-session PTY. When the process exits — whether the user completed the
 * browser flow or aborted it — the PTY exits, which is the setup step's
 * completion signal to re-detect.
 */
export function buildGhAuthLoginArgv(): string[] {
  return [
    "gh",
    "auth",
    "login",
    "--web",
    "--git-protocol",
    "https",
    "--scopes",
    GH_AUTH_SCOPE,
  ]
}
