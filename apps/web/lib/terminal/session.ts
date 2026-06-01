/**
 * Naming for the per-tab `tmux` sessions that back the persistent terminal
 * (#259). Pure (no DOM, no server imports) so both the client — which passes
 * the name to ttyd as a `?arg=` URL argument — and the server — which kills the
 * session when a tab is closed — derive it from the same place, and it stays
 * unit-testable in the Node environment.
 *
 * Each terminal tab gets its own `tmux` session named `screenplay-<tabId>`,
 * where `<tabId>` is the tab's `terminalSessionId`. ttyd launches
 * `tmux new -A -s <name>` (attach-or-create), so reloading a live sandbox
 * reattaches to the same session — with any running harness intact — and two
 * tabs against the same Branch get isolated sessions rather than colliding on
 * one PTY.
 */

/**
 * Prefix every session name carries, so the sandbox's `tmux` sessions are
 * unambiguously ours (and a future orphan-cleanup pass can match on it).
 */
export const TMUX_SESSION_PREFIX = "screenplay-"

/**
 * The `tmux` session name for a terminal tab. `terminalSessionId` is a `nanoid`
 * (URL-safe `A-Za-z0-9_-`), which carries no `tmux`-illegal characters (`.`/`:`),
 * so the name is a safe `tmux` target and a safe ttyd URL argument as-is.
 */
export function tmuxSessionName(terminalSessionId: string): string {
  return `${TMUX_SESSION_PREFIX}${terminalSessionId}`
}
