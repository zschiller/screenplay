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
 * plus the composer's inline markers: `[skill: <name>]` — encoded by
 * `serializeSkill` and recovered into its renderer pill by
 * `skillMarkersToPills` — and the `[@…](mention:…)` Layer mention, encoded
 * by `serializeMention`. Mention tokens stay inline in the parsed `body`,
 * so the renderer recovers them as doc-icon pills straight from the
 * markdown-link form. The `Referenced documents:` footer is built by
 * `buildReferencedDocsFooter` and stripped by `parseUserMessage`, which sets
 * `hadReferencedDocs` and recovers the original body exactly.
 *
 * Targeted preview elements ride the same pattern: `serializeElement` encodes
 * an inline `[element: <label>](element:<ref>)` marker (its visible label
 * derived purely by `deriveElementLabel`), `elementMarkersToPills` recovers it
 * into the renderer's styled token, and the actionable route + selector detail
 * rides a `Targeted elements:` footer built by `buildTargetedElementsFooter`
 * and stripped by `parseUserMessage` (which sets `hadTargetedElements`).
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
  return body.replace(
    SKILL_MARKER_RE,
    (_m, name) => `[/${name}](skill:${name})`
  )
}

/**
 * The Layer mention marker's prose template, `[@<title>](mention:<id>)`, as
 * referenced by the system prompt. The `<title>` and `<id>` placeholders are
 * literal — this is the wire shape the model is told to look for, not a marker
 * rendered for a concrete Layer (use `serializeMention` for that).
 */
export const MENTION_MARKER_TOKEN = `[@<title>](mention:<id>)`

/**
 * Serialize an `@`-Layer mention into its inline `[@<label>](mention:<id>)`
 * markdown-link marker. The composer emits this in the wire body; the Engine
 * resolves the title to its id and reads the doc, and the message renderer
 * recovers it as a doc-icon pill directly from the markdown-link form (no
 * separate pill transform is needed — the token *is* the pill markup).
 */
export function serializeMention(label: string, id: string): string {
  return `[@${label}](mention:${id})`
}

/** Label used by the inline element marker: `[element: <label>](element:<ref>)`. */
export const ELEMENT_MARKER_LABEL = "element"

/**
 * The element marker's prose template, `[element: <label>](element:<ref>)`, as
 * a companion to `MENTION_MARKER_TOKEN`. The `<label>` and `<ref>` placeholders
 * are literal — this is the wire shape, not a marker rendered for a concrete
 * element (use `serializeElement` for that). The `<ref>` correlates the inline
 * marker to its `Targeted elements:` footer entry.
 */
export const ELEMENT_MARKER_TOKEN = `[${ELEMENT_MARKER_LABEL}: <label>](${ELEMENT_MARKER_LABEL}:<ref>)`

/**
 * Derive an element token's visible label purely from its pick result. The
 * label is the element's `tagName` (e.g. `button`), plus `#<id>` only when the
 * element carries an id (e.g. `button#submit`). Class names are deliberately
 * never included — Tailwind classes are noise. `tagName` is supplied
 * explicitly by the picker, not regex'd out of the CSS selector; an absent or
 * empty `id` yields the bare tag name.
 */
export function deriveElementLabel(tagName: string, id?: string): string {
  return id ? `${tagName}#${id}` : tagName
}

/**
 * Serialize a targeted preview element into its inline
 * `[element: <label>](element:<ref>)` markdown-link marker (mirroring
 * `serializeMention`). The composer emits this in the wire body; the actionable
 * route + selector detail rides the `Targeted elements:` footer keyed by the
 * same `ref`, and `elementMarkersToPills` recovers the marker as a styled token
 * in chat history. `label` should come from `deriveElementLabel`.
 */
export function serializeElement(label: string, ref: string): string {
  return `[${ELEMENT_MARKER_LABEL}: ${label}](${ELEMENT_MARKER_LABEL}:${ref})`
}

// Inline element markers can appear anywhere in the body, so this matches
// globally. The label capture stops at the first `]` and the ref at the first
// `)` to keep each marker self-contained.
const ELEMENT_MARKER_RE = /\[element:\s*([^\]]+)\]\(element:([^)]+)\)/g

/**
 * Renderer-only transform: rewrite each inline
 * `[element: <label>](element:<ref>)` marker into the token markdown-link form
 * `[<label>](element:<ref>)` the message renderer draws as a crosshair chip
 * (mirroring `skillMarkersToPills`). The `element:` scheme is preserved so the
 * renderer keys off it; only the redundant `element: ` prefix is dropped from
 * the visible link text, leaving just the derived label. All other text is
 * left untouched.
 */
export function elementMarkersToPills(body: string): string {
  return body.replace(
    ELEMENT_MARKER_RE,
    (_m, label, ref) => `[${label}](element:${ref})`
  )
}

/**
 * The canonical token that opens the referenced-documents footer. It is the
 * single source of truth for both the build side (`buildReferencedDocsFooter`)
 * and the strip side (`parseUserMessage`), so the composer and renderer can
 * never drift apart on it again.
 */
export const REFERENCED_DOCS_FOOTER_TOKEN = "Referenced documents:"

/** A canvas doc referenced by an `@`-mention, paired with its display title. */
export interface ReferencedDoc {
  id: string
  title?: string
}

/**
 * Build the referenced-documents footer for a set of `@`-mentioned docs,
 * returned as a suffix to append to the user message body. Bodies are NOT
 * inlined — the footer only pairs each id with its title, since the agent
 * loop can `read_document(id)` for the live state on demand. This keeps chat
 * history bounded and avoids stale snapshots when a mentioned layer is later
 * edited.
 *
 * Returns an empty string when there are no docs, so callers can append
 * unconditionally. The footer opens with `REFERENCED_DOCS_FOOTER_TOKEN`, which
 * `parseUserMessage` keys off to strip it back out — `body + footer` then
 * round-trips through `parseUserMessage` to the original `body` exactly.
 */
export function buildReferencedDocsFooter(docs: ReferencedDoc[]): string {
  if (docs.length === 0) return ""
  const lines = docs.map(
    (d) => `- markdown-layer ${d.id}: ${d.title || "Untitled"}`
  )
  return [
    "",
    "",
    "---",
    "",
    `${REFERENCED_DOCS_FOOTER_TOKEN} (call \`read_document\` with the id to load contents)`,
    ...lines,
  ].join("\n")
}

/**
 * The canonical token that opens the targeted-elements footer, shared by the
 * build side (`buildTargetedElementsFooter`) and the strip side
 * (`parseUserMessage`) so they can never drift apart.
 */
export const TARGETED_ELEMENTS_FOOTER_TOKEN = "Targeted elements:"

/**
 * A preview element referenced by an inline `[element: …](element:<ref>)`
 * marker, paired with the actionable detail the agent needs to act on it. The
 * `ref` correlates this entry to its inline marker; `route` is the page the
 * element lives on, `selector` its full CSS selector, and `frameLabel` the
 * display name of the frame it belongs to.
 */
export interface TargetedElement {
  ref: string
  route: string
  selector: string
  frameLabel: string
  /**
   * The id of the Iframe Layer the element lives in. Not agent-facing detail —
   * it rides an optional `[layer: <id>]` suffix purely so the message renderer
   * can re-highlight the element on the canvas when a history token is hovered
   * (the composer reads the same id from its live node attrs). Absent on legacy
   * turns saved before this was carried; the renderer then just skips the
   * highlight.
   */
  iframeLayerId?: string
}

/**
 * Build the targeted-elements footer for a set of picked preview elements,
 * returned as a suffix to append to the user message body. This is the
 * actionable counterpart to the inline `[element: <label>](element:<ref>)`
 * markers: the visible label stays terse in the message bubble, while the full
 * route + CSS selector (+ frame label) rides here, keyed by `ref`, so the agent
 * can locate each element precisely.
 *
 * Returns an empty string when there are no elements, so callers can append
 * unconditionally. The footer opens with `TARGETED_ELEMENTS_FOOTER_TOKEN`,
 * which `parseUserMessage` keys off to strip it back out — `body + footer` then
 * round-trips through `parseUserMessage` to the original `body` exactly.
 */
export function buildTargetedElementsFooter(
  elements: TargetedElement[]
): string {
  if (elements.length === 0) return ""
  const lines = elements.map(
    (e) =>
      `- ${e.ref}: ${e.route} — ${e.selector} (frame: ${e.frameLabel})` +
      // App-only trailer (see `TargetedElement.iframeLayerId`); omitted when
      // absent so agent-facing lines stay clean and legacy turns round-trip.
      (e.iframeLayerId ? ` [layer: ${e.iframeLayerId}]` : "")
  )
  return [
    "",
    "",
    "---",
    "",
    `${TARGETED_ELEMENTS_FOOTER_TOKEN} (each [element: …](element:<ref>) above targets one entry here, matched by ref)`,
    ...lines,
  ].join("\n")
}

/**
 * Prepend the server turn prefixes to a user message body, plan before
 * branch. Each prefix is emitted only when its input is present, so a turn
 * with neither marker returns `body` unchanged.
 */
export function prependTurnMarkers(
  body: string,
  opts: { planMode?: boolean; branch?: string }
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
   * The message with the server prefixes stripped. Inline `[skill: <name>]`,
   * `[@…](mention:…)`, and `[element: …](element:…)` tokens are retained so the
   * renderer can recover their pills (skill via `skillMarkersToPills`; elements
   * via `elementMarkersToPills`; mentions straight from the inline markdown-link
   * form).
   */
  body: string
  /**
   * Whether a referenced-documents footer was detected and stripped from
   * `body`. The footer is the suffix `buildReferencedDocsFooter` appends.
   */
  hadReferencedDocs: boolean
  /**
   * Whether a targeted-elements footer was detected and stripped from `body`.
   * The footer is the suffix `buildTargetedElementsFooter` appends.
   */
  hadTargetedElements: boolean
}

// The branch prefix terminates at the first `] ` (bracket immediately
// followed by a space), which is exactly what `prependTurnMarkers` emits.
// Anchoring on that pair — rather than the first `]` — lets a branch ref
// contain spaces and brackets while still parsing back exactly.
const PLAN_PREFIX_RE = /^\[plan mode: enabled\] /
const BRANCH_PREFIX_RE = /^\[branch: (.*?)\] /
// Built from the canonical token so build and strip can't drift. The footer
// runs from its `\n\n---\n\n` separator to the end of the message, so a single
// strip recovers the original body exactly.
const REFERENCED_DOCS_FOOTER_RE = new RegExp(
  `\\n\\n---\\n\\n${REFERENCED_DOCS_FOOTER_TOKEN}[\\s\\S]*$`
)
// Same `\n\n---\n\n`-anchored, run-to-end shape as the referenced-docs footer.
// Both footers run to end-of-message, so when a turn carries both, each regex
// detects its own token and the strip below removes whichever begins first,
// regardless of their relative order.
const TARGETED_ELEMENTS_FOOTER_RE = new RegExp(
  `\\n\\n---\\n\\n${TARGETED_ELEMENTS_FOOTER_TOKEN}[\\s\\S]*$`
)
// One targeted-element detail line, exactly as `buildTargetedElementsFooter`
// emits it: `- <ref>: <route> — <selector> (frame: <frameLabel>)` with an
// optional ` [layer: <id>]` app-only trailer. `ref` holds no `:` (it's a
// nanoid); `route` stops at the first ` — `; `selector` runs greedily up to the
// trailing ` (frame: …)`, whose label may itself contain parens; `<id>` (also a
// nanoid) holds no `]`, so the trailer is unambiguous even then.
const TARGETED_ELEMENTS_LINE_RE =
  /^- ([^:]+): (.+?) — (.+) \(frame: (.*)\)(?: \[layer: ([^\]]+)\])?$/

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

  // Detect both footers before stripping either — each footer runs to
  // end-of-message, so stripping the earlier one first would swallow the later
  // one and hide its flag. The strips themselves are order-independent: each
  // regex anchors on its own token, so removing one leaves the other intact
  // until its own strip runs.
  const hadReferencedDocs = REFERENCED_DOCS_FOOTER_RE.test(body)
  const hadTargetedElements = TARGETED_ELEMENTS_FOOTER_RE.test(body)
  if (hadReferencedDocs) {
    body = body.replace(REFERENCED_DOCS_FOOTER_RE, "")
  }
  if (hadTargetedElements) {
    body = body.replace(TARGETED_ELEMENTS_FOOTER_RE, "")
  }

  return {
    planMode,
    branch,
    body,
    hadReferencedDocs,
    hadTargetedElements,
  }
}

/**
 * Recover the `Targeted elements:` footer's entries from a wire user message —
 * the actionable detail (`route`, `selector`, `frameLabel`) `parseUserMessage`
 * strips out, keyed by the same `ref` its inline `[element: …](element:<ref>)`
 * markers carry. The renderer uses this to hang a hover card off each history
 * token (the composer reads the equivalent detail from its node attrs). Returns
 * an empty array when no footer is present, and silently skips any line that
 * doesn't match the canonical shape.
 */
export function parseTargetedElementsFooter(wire: string): TargetedElement[] {
  const match = wire.match(TARGETED_ELEMENTS_FOOTER_RE)
  if (!match) return []
  const out: TargetedElement[] = []
  for (const line of match[0].split("\n")) {
    const m = line.match(TARGETED_ELEMENTS_LINE_RE)
    if (m) {
      out.push({
        ref: m[1],
        route: m[2],
        selector: m[3],
        frameLabel: m[4],
        // `undefined` on a legacy line with no `[layer: …]` trailer.
        iframeLayerId: m[5],
      })
    }
  }
  return out
}
