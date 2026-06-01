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
 * plus the composer's inline `[skill: <name>]` marker — encoded by
 * `serializeSkill` and recovered into its renderer pill by
 * `skillMarkersToPills`. The `[@…](mention:…)` serialization and the
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

/** Label used by the inline skill marker: `[skill: <name>]`. */
export const SKILL_MARKER_LABEL = "skill"

/**
 * The skill marker's prose template, `[skill: <name>]`, as referenced by the
 * system prompt's explicit-invocation rule. The `<name>` placeholder is
 * literal — this is the form the model is told to look for, not a marker
 * rendered for a concrete skill (use `serializeSkill` for that).
 */
export const SKILL_MARKER_TOKEN = `[${SKILL_MARKER_LABEL}: <name>]`

/**
 * Serialize an explicit `/`-Skill invocation into its inline `[skill: <name>]`
 * marker. The composer emits this in the wire body; the Engine treats it as a
 * mandatory `read_skill` instruction, and `skillMarkersToPills` recovers it
 * as a pill in the user's message.
 */
export function serializeSkill(name: string): string {
  return `[${SKILL_MARKER_LABEL}: ${name}]`
}

// Inline skill markers can appear anywhere in the body (not just as a
// prefix), so this matches globally. The capture stops at the first `]` to
// keep the marker self-contained.
const SKILL_MARKER_RE = /\[skill:\s*([^\]]+)\]/g

/**
 * Renderer-only transform: rewrite each inline `[skill: <name>]` marker into
 * the pill markdown link form `[/<name>](skill:<name>)` the message renderer
 * draws as a Sparkles chip. All other text is left untouched.
 */
export function skillMarkersToPills(body: string): string {
  return body.replace(SKILL_MARKER_RE, (_m, name) => `[/${name}](skill:${name})`)
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
   * The message with the server prefixes stripped. Inline `[skill: <name>]`
   * and mention tokens are retained so the renderer can recover their pills
   * (skill via `skillMarkersToPills`; mentions in a later slice).
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
