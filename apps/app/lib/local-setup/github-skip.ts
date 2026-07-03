/**
 * The persisted **"Skip for now"** bit for the GitHub half of the first-run gate
 * (ADR 0016). The gate hard-requires a Harness (Step 1) but, honoring the ADR
 * 0008 no-auth floor, lets the user **skip** the optional GitHub Connection
 * (Step 2) — and that skip must survive a relaunch so the gate never nags about
 * GitHub again.
 *
 * Like `home-view-prefs`, the bit lives in a **cookie**, not the keychain: it is
 * not a secret (only the gate reads it) and it must be visible **server-side** so
 * the root layout can fold it into `initiallyBlocked` before first paint — a
 * skipped, harness-satisfied user gets no gate and no flash. It is written
 * **client-side** when the user clicks Skip ({@link writeGitHubSkip}) and parsed
 * **server-side** by the layout ({@link parseGitHubSkip}), mirroring the
 * `home-view-prefs` `parse` (server) / `write` (client) split.
 *
 * The value is a single sentinel `"1"`; the parse is deliberately strict, so a
 * missing, empty, or hand-edited/garbage cookie reads as **not skipped**
 * (`false`) — the safe default that keeps offering the connection rather than
 * silently hiding it.
 */

const COOKIE_NAME = "github_setup_skipped"

/** The lone value a skipped cookie carries; anything else parses as not-skipped. */
const SKIPPED_VALUE = "1"

const MAX_AGE = 60 * 60 * 24 * 365

/** The cookie the GitHub-skip bit persists under (read server-side by the layout). */
export function githubSkipCookieName(): string {
  return COOKIE_NAME
}

/**
 * Parse the skip cookie's raw value into the boolean the release predicate reads.
 * Strict by design: **only** the exact sentinel counts as skipped, so a missing
 * (`undefined`), empty, or malformed value defaults to `false` — the gate keeps
 * offering GitHub rather than trusting a garbage cookie to hide it.
 */
export function parseGitHubSkip(rawValue: string | undefined): boolean {
  return rawValue === SKIPPED_VALUE
}

/**
 * Persist the skip client-side (the `home-view-prefs` write pattern): a
 * long-lived, path-`/`, lax cookie the server layout reads on the next launch.
 * A no-op off the browser so it is safe to import anywhere.
 */
export function writeGitHubSkip(): void {
  if (typeof document === "undefined") return
  document.cookie = `${COOKIE_NAME}=${SKIPPED_VALUE}; path=/; max-age=${MAX_AGE}; samesite=lax`
}
