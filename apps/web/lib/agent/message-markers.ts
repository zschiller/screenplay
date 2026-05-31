/**
 * Message Markers — the single owner of the chat-turn wire format.
 *
 * A chat turn's metadata is smuggled into the user-message string as ad-hoc
 * text markers. This module is the one place that format lives, so the
 * composer, stream route, history route, and message renderer can all cross
 * its interface to encode and decode instead of each carrying their own
 * inline string-building or regex copy.
 *
 * This slice owns the two *server-prepended* turn prefixes:
 *
 *   - `[plan mode: enabled]` — flags the Engine to submit a plan first.
 *   - `[branch: <ref>]`      — attaches the chat's working branch.
 *
 * The composer's `[skill:]` / `[@…](mention:…)` serialization and the
 * `Referenced documents:` footer land in a later slice; `parseUserMessage`
 * reserves `hadReferencedDocs` for that, but does not act on it yet.
 *
 * The codec owns **format, not policy**: callers still decide *when* a
 * marker applies (e.g. branch only on the first message of a chat). This
 * module only knows how to render and parse the tokens.
 *
 * It is deliberately **isomorphic** — it must not import `server-only`,
 * because the composer and renderer are client components while the
 * stream/history routes are server code, and they all import it.
 */

/** Literal prefix the server prepends when plan mode is enabled. */
export const PLAN_MODE_MARKER = "[plan mode: enabled]"

/** Label used by the parameterized branch prefix: `[branch: <ref>]`. */
export const BRANCH_MARKER_LABEL = "branch"

/** Renders the parameterized branch prefix for a given ref. */
function branchMarker(branch: string): string {
  return `[${BRANCH_MARKER_LABEL}: ${branch}]`
}

/**
 * Prepend the server turn prefixes to a user message body, plan before
 * branch. Each prefix is emitted only when its input is present, so a turn
 * with neither marker returns `body` unchanged.
 */
export function prependTurnMarkers(
  body: string,
  opts: { planMode?: boolean; branch?: string },
): string {
  const planPrefix = opts.planMode ? `${PLAN_MODE_MARKER} ` : ""
  const branchPrefix = opts.branch ? `${branchMarker(opts.branch)} ` : ""
  return `${planPrefix}${branchPrefix}${body}`
}

export interface ParsedUserMessage {
  /** True when the `[plan mode: enabled]` prefix was present. */
  planMode: boolean
  /** The branch ref from the `[branch: <ref>]` prefix, if present. */
  branch?: string
  /**
   * The message with the server prefixes stripped. Inline `[skill:]` /
   * mention tokens (handled in a later slice) are retained for the renderer.
   */
  body: string
  /**
   * Whether a `Referenced documents:` footer was detected. Reserved for a
   * later slice — populated for completeness but not stripped here.
   */
  hadReferencedDocs: boolean
}

// The branch prefix terminates at the first `] ` (bracket immediately
// followed by a space), which is exactly what `prependTurnMarkers` emits.
// Anchoring on that pair — rather than the first `]` — lets a branch ref
// contain spaces and brackets while still parsing back exactly.
const PLAN_PREFIX_RE = /^\[plan mode: enabled\] /
const BRANCH_PREFIX_RE = /^\[branch: (.*?)\] /
const REFERENCED_DOCS_RE = /\n\n---\n\nReferenced documents:/

/**
 * Parse a wire user message back into its turn metadata and clean body.
 * A no-op on a string that carries no prefixes: `planMode` is false,
 * `branch` is undefined, and `body` is the input unchanged.
 */
export function parseUserMessage(wire: string): ParsedUserMessage {
  let body = wire
  let planMode = false
  let branch: string | undefined

  if (PLAN_PREFIX_RE.test(body)) {
    planMode = true
    body = body.replace(PLAN_PREFIX_RE, "")
  }

  const branchMatch = body.match(BRANCH_PREFIX_RE)
  if (branchMatch) {
    branch = branchMatch[1]
    body = body.replace(BRANCH_PREFIX_RE, "")
  }

  return {
    planMode,
    branch,
    body,
    hadReferencedDocs: REFERENCED_DOCS_RE.test(body),
  }
}
