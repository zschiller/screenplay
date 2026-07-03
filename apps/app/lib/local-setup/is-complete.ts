import type { HarnessSetupStatus } from "@/lib/agent/harnesses/setup-status"

/**
 * The single, shared definition of "set up enough to open the desktop app"
 * (ADR 0016). Every function here is **pure over its inputs** and — the whole
 * point — the release decision is computed **identically** server-side (the root
 * layout's initial-paint `initiallyBlocked`) and client-side (the gate's poll),
 * so the two can never drift into a modal-over-app or app-over-modal
 * disagreement.
 *
 * The gate ships only the derived booleans to the client (see
 * {@link deriveGateStatus} / `getLocalSetupGateStatus`), never a raw credential
 * shape, so these predicates are split into the raw-shape sub-predicates
 * ({@link harnessSatisfied} / {@link githubSatisfied}, evaluated server-side) and
 * the boolean combiner ({@link isLocalSetupComplete}, called on both sides over
 * what the poll returns).
 */

/**
 * The GitHub facts the release predicate reads. Only the resolved-token
 * *source* matters — never a raw token or handle — so this is the entire shape
 * the decision needs and nothing sensitive rides along with it.
 */
export interface GitHubSatisfiedFacts {
  /** Where a token actually resolved (`gh` or device flow), or `null` for none. */
  tokenSource: "gh" | "device" | null
}

/**
 * The harness half: **some** Harness Setup row is installed and not *known*
 * signed-out. Deliberately `authenticated !== false`, **not** `=== true`: ADR
 * 0015's auth probes are best-effort, so a genuinely signed-in CLI whose
 * credential the probe can't read resolves to `null` — and on a screen the user
 * can't escape, that indeterminate case must be tolerated rather than
 * false-blocking a working install. A *known* signed-out CLI (`false`) still
 * blocks; presence (`installed`) is always required.
 */
export function harnessSatisfied(harnesses: HarnessSetupStatus[]): boolean {
  return harnesses.some((row) => row.installed && row.authenticated !== false)
}

/**
 * The GitHub half: a token actually resolved (via `gh` **or** device flow) —
 * exactly what the connection panel calls "Connected" — not merely
 * "`gh` installed".
 */
export function githubSatisfied(github: GitHubSatisfiedFacts): boolean {
  return github.tokenSource !== null
}

/**
 * The two satisfied facts the gate polls for, plus the persisted GitHub-skip
 * bit — everything {@link isLocalSetupComplete} needs, and all the gate ever
 * ships to the client (booleans only).
 */
export interface LocalSetupFacts {
  harnessSatisfied: boolean
  githubSatisfied: boolean
  githubSkipped: boolean
}

/**
 * The release decision: a usable harness is **required**, while GitHub is
 * satisfied by a live connection **or** a persisted skip (honoring the ADR 0008
 * no-auth floor). Combines the already-computed `harnessSatisfied` /
 * `githubSatisfied` facts so the exact same call runs server-side (initial
 * paint) and client-side (poll) over what `getLocalSetupGateStatus()` returns.
 */
export function isLocalSetupComplete({
  harnessSatisfied,
  githubSatisfied,
  githubSkipped,
}: LocalSetupFacts): boolean {
  return harnessSatisfied && (githubSatisfied || githubSkipped)
}

/**
 * Derive the two release booleans from the live status reads — the pure core of
 * the `getLocalSetupGateStatus()` server action, factored out so it is
 * unit-testable against faked status results and so the action stays a thin
 * live-read wrapper. Returns **only** the two booleans: no raw credential shape
 * (token, handle, device-token presence) ever rides to the client.
 */
export function deriveGateStatus(input: {
  harnesses: HarnessSetupStatus[]
  github: GitHubSatisfiedFacts
}): { harnessSatisfied: boolean; githubSatisfied: boolean } {
  return {
    harnessSatisfied: harnessSatisfied(input.harnesses),
    githubSatisfied: githubSatisfied(input.github),
  }
}
