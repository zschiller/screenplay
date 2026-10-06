/**
 * Message Markers — the single owner of the chat-turn wire format.
 *
 * A chat turn's metadata is smuggled into the user-message string as ad-hoc
 * text markers. This module is the one place that format lives, so the
 * composer, stream route, history route, and message renderer can all cross
 * its interface to encode and decode instead of each carrying their own
 * inline string-building or regex copy.
 *
 * This slice owns the four *server-prepended* turn prefixes:
 *
 *   - `[pr event: <number> <kind>[ <detail>]]` — marks a PR event (#1702):
 *     PR Watch's report that the chat's PR changed (checks failed, merged…).
 *     Shown as a quiet line, never as a bubble.
 *   - `[workspace update: <workspaceId>]` — marks a Coordinator wake: the
 *     server's report that a Workspace's turn ended. Never shown.
 *   - `[from coordinator: <chatId>]` — marks a Delegated Message: a turn the
 *     Room's Coordinator chat (`<chatId>`) sent into a Workspace chat.
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
 * The sender's selection and screen ride a `Canvas view:` footer built by
 * `buildCanvasViewFooter` and stripped by `parseUserMessage`; only the model
 * reads it.
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

/** Label used by the Delegated Message prefix: `[from coordinator: <chatId>]`. */
export const DELEGATED_MARKER_LABEL = "from coordinator"

/** Renders the Delegated Message prefix for the sending Coordinator chat. */
function delegatedMarker(chatId: string): string {
  return `[${DELEGATED_MARKER_LABEL}: ${chatId}]`
}

/** Label used by the Coordinator wake prefix: `[workspace update: <id>]`. */
export const WAKE_MARKER_LABEL = "workspace update"

/** Renders the Coordinator wake prefix for the Workspace whose turn ended. */
function wakeMarker(workspaceId: string): string {
  return `[${WAKE_MARKER_LABEL}: ${workspaceId}]`
}

/** Label used by the PR event prefix: `[pr event: <number> <kind>]`. */
export const PR_EVENT_MARKER_LABEL = "pr event"

/** What happened to a chat's PR, as PR Watch reports it (#1702). */
export type PrEventKind =
  | "checks_failed"
  | "checks_passed"
  | "conflict"
  | "review"
  | "merged"
  | "closed"

const PR_EVENT_KINDS: ReadonlySet<string> = new Set<PrEventKind>([
  "checks_failed",
  "checks_passed",
  "conflict",
  "review",
  "merged",
  "closed",
])

/** A PR event as its marker carries it: the PR, what happened, and a short
 *  detail (the failing checks' names, or a review's author and comments). */
export interface PrEventMark {
  number: number
  kind: PrEventKind
  detail?: string
}

/** Renders the PR event prefix. The detail is URI-encoded, so it holds no
 *  space or `]` and the prefix parses back exactly. */
function prEventMarker({ number, kind, detail }: PrEventMark): string {
  const tail = detail ? ` ${encodeURIComponent(detail)}` : ""
  return `[${PR_EVENT_MARKER_LABEL}: ${number} ${kind}${tail}]`
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
 * draws as a skill chip. All other text is left untouched.
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

/** The refs of a body's inline `[element: …](element:<ref>)` markers, in order. */
export function elementMarkerRefs(body: string): string[] {
  return [...body.matchAll(ELEMENT_MARKER_RE)].map((m) => m[2]!)
}

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

// The `[mockup: <id>]` marker a drawn Mockup box's ask names its Mockup with
// (`forMockup` in lib/draw-ask.ts), with the sentence around it that's only
// for the agent. Not a markdown link, so it must not be followed by `(`; the
// id is a nanoid and holds no `]`.
const MOCKUP_ASK_RE = /Mockup \[mockup:\s*([^\]\s]+)\] with update_mockup/g
const MOCKUP_MARKER_RE = /\[mockup:\s*([^\]\s]+)\](?!\()/g

/**
 * Renderer-only transform: rewrite each `[mockup: <id>]` marker into the
 * reference link form `[Mockup](mockup:<id>)` (mirroring
 * `elementMarkersToPills`), dropping forMockup's "Mockup … with update_mockup"
 * wording around it, so "Sketch it in Mockup [mockup: m-1] with
 * update_mockup. The box …" reads "Sketch it in [Mockup](mockup:m-1). The box …". The
 * renderer swaps in the Mockup's live title; `Mockup` is only the fallback.
 */
export function mockupMarkersToRefs(body: string): string {
  return body
    .replace(MOCKUP_ASK_RE, (_m, id) => `[Mockup](mockup:${id})`)
    .replace(MOCKUP_MARKER_RE, (_m, id) => `[Mockup](mockup:${id})`)
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
  /**
   * "mockup" for an element in a Mockup (#1309), whose `route` is then
   * `mockup <id>` and whose line names it `(mockup: <title>)` in place of
   * `(frame: <label>)`, so the agent reads the page with `read_mockup`.
   */
  layerKind?: "mockup"
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
      `- ${e.ref}: ${e.route} — ${e.selector} (${e.layerKind ?? "frame"}: ${e.frameLabel})` +
      // App-only trailer (see `TargetedElement.iframeLayerId`); omitted when
      // absent so agent-facing lines stay clean and legacy turns round-trip.
      (e.iframeLayerId ? ` [layer: ${e.iframeLayerId}]` : "")
  )
  return [
    "",
    "",
    "---",
    "",
    `${TARGETED_ELEMENTS_FOOTER_TOKEN} (each [element: …](element:<ref>) above targets one entry here, matched by ref` +
      // An element in a Mockup has no route or code to find it in: say where
      // its page is, only when one is there so frame-only footers stay as is.
      (elements.some((e) => e.layerKind === "mockup")
        ? "; an entry in a Mockup names it as `mockup <id>`: read its page with read_mockup and change it with update_mockup)"
        : ")"),
    ...lines,
  ].join("\n")
}

/**
 * The canonical token that opens the canvas-view footer, shared by the build
 * side (`buildCanvasViewFooter`) and the strip side (`parseUserMessage`).
 */
export const CANVAS_VIEW_FOOTER_TOKEN = "Canvas view:"

/** One layer named in a canvas-view footer. */
export interface CanvasViewItem {
  kind: "frame" | "document" | "mockup" | "group"
  id: string
  name: string
  /** A frame's Workspace, by its title. */
  workspace?: string
}

/**
 * What the sender had selected and on screen when they sent a message. Each
 * member's browser takes its own at send time, so on a shared canvas every
 * message carries its sender's view, never anyone else's.
 */
export interface CanvasView {
  /** The sender's display name. */
  sender?: string
  selected: CanvasViewItem[]
  /** On screen, the largest share of the screen first. */
  onScreen: CanvasViewItem[]
}

function canvasViewLine(item: CanvasViewItem): string {
  // Quoted names keep every line ending in `"`, so no line ever reads as a
  // targeted-element line when both footers ride one message.
  return (
    `- ${item.kind} [${item.id}] ${JSON.stringify(item.name)}` +
    (item.workspace ? ` · Workspace ${JSON.stringify(item.workspace)}` : "")
  )
}

/**
 * Build the canvas-view footer: the sender's selection and what was on their
 * screen, so "this" or "that frame" resolves to what they meant. Returns an
 * empty string when there is neither, so callers can append unconditionally.
 *
 * Unlike the other footers it doesn't run to the end of the message: its
 * lines stop at the first one that isn't a heading or an item, so leftover
 * Steers joined into one message each keep their own footer and
 * `parseUserMessage` strips every one of them.
 */
export function buildCanvasViewFooter(view: CanvasView | null): string {
  if (!view || (view.selected.length === 0 && view.onScreen.length === 0)) {
    return ""
  }
  const who = view.sender?.trim() || "The sender"
  return [
    "",
    "",
    "---",
    "",
    `${CANVAS_VIEW_FOOTER_TOKEN} what ${who} had selected and on screen when they sent this message`,
    ...(view.selected.length > 0
      ? ["Selected:", ...view.selected.map(canvasViewLine)]
      : []),
    ...(view.onScreen.length > 0
      ? ["On screen:", ...view.onScreen.map(canvasViewLine)]
      : []),
  ].join("\n")
}

/**
 * The canonical token that opens the attachments footer (#1525), shared by
 * the build side (`buildAttachmentsFooter`) and the strip side
 * (`parseUserMessage`, `parseAttachmentsFooter`).
 */
export const ATTACHMENTS_FOOTER_TOKEN = "Attached files:"

/**
 * A file attached to a message: saved in Canvas Files (under `uploads/`),
 * named here by its path so the agent can open it and the message can show a
 * chip for it.
 */
export interface MessageAttachment {
  /** Its path in Canvas Files. */
  path: string
  mediaType: string
  /** Bytes. */
  size: number
}

function attachmentLine(a: MessageAttachment): string {
  // A quoted path, so a name with spaces or parens parses back exactly.
  return `- ${JSON.stringify(a.path)} (${a.mediaType}, ${a.size} bytes)`
}

/**
 * Build the attachments footer: the files the sender attached, by their path
 * in the canvas's files, so the agent can open them with `read_saved_file`.
 * Returns an empty string when there are none, so callers can append
 * unconditionally. Like the canvas-view footer, its lines stop at the first
 * that isn't an item, so a message joined from several Steers keeps each.
 */
export function buildAttachmentsFooter(
  attachments: readonly MessageAttachment[]
): string {
  if (attachments.length === 0) return ""
  return [
    "",
    "",
    "---",
    "",
    `${ATTACHMENTS_FOOTER_TOKEN} the sender attached these to this message. They’re saved in the canvas’s files; open one with \`read_saved_file\`.`,
    ...attachments.map(attachmentLine),
  ].join("\n")
}

/**
 * The canonical token that opens the drafted-on footer (#1645), shared by the
 * build side (`buildDraftedOnFooter`) and the strip side (`parseUserMessage`).
 */
export const DRAFTED_ON_FOOTER_TOKEN = "Drafted on mockup:"

/**
 * Build the drafted-on footer: the Mockup whose page drafted this message into
 * the composer (`screenplay.draft`), so a page’s “Picked B” reaches the agent
 * with the page it is about. One line, only the model reads it. Returns an
 * empty string for a message typed in the composer.
 */
export function buildDraftedOnFooter(
  mockup: { id: string; title: string } | null
): string {
  if (!mockup) return ""
  return [
    "",
    "",
    "---",
    "",
    `${DRAFTED_ON_FOOTER_TOKEN} the sender wrote this message from the page of mockup [${mockup.id}] ${JSON.stringify(mockup.title || "Untitled")}; read it with read_mockup.`,
  ].join("\n")
}

/**
 * Prepend the server turn prefixes to a user message body: PR event, wake,
 * delegation, then plan, then branch. Each prefix is emitted only when its input is
 * present, so a turn with no marker returns `body` unchanged.
 */
export function prependTurnMarkers(
  body: string,
  opts: {
    planMode?: boolean
    branch?: string
    delegatedFrom?: string
    wakeFrom?: string
    prEvent?: PrEventMark
  }
): string {
  const prEventPrefix = opts.prEvent ? `${prEventMarker(opts.prEvent)} ` : ""
  const wakePrefix = opts.wakeFrom ? `${wakeMarker(opts.wakeFrom)} ` : ""
  const delegatedPrefix = opts.delegatedFrom
    ? `${delegatedMarker(opts.delegatedFrom)} `
    : ""
  const planPrefix = opts.planMode ? `${PLAN_MODE_MARKER} ` : ""
  const branchPrefix = opts.branch ? `${branchMarker(opts.branch)} ` : ""
  return `${prEventPrefix}${wakePrefix}${delegatedPrefix}${planPrefix}${branchPrefix}${body}`
}

export interface ParsedUserMessage {
  /** The PR event this message reports (the `[pr event: …]` prefix). */
  prEvent?: PrEventMark
  /**
   * The Workspace whose turn ended when this is a Coordinator wake (the
   * `[workspace update: <id>]` prefix was present).
   */
  wakeFrom?: string
  /**
   * The sending Coordinator chat's id when this is a Delegated Message (the
   * `[from coordinator: <chatId>]` prefix was present).
   */
  delegatedFrom?: string
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
// A Coordinator chat id holds no `]`, so the first one ends the prefix.
// A Workspace id holds no `]` either.
const PR_EVENT_PREFIX_RE = /^\[pr event: (\d+) ([a-z_]+)(?: ([^\] ]+))?\] /
const WAKE_PREFIX_RE = /^\[workspace update: ([^\]]+)\] /
const DELEGATED_PREFIX_RE = /^\[from coordinator: ([^\]]+)\] /
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
// The canvas-view footer stops at its last heading or item line rather than
// running to the end, so every one in a joined message strips on its own.
const CANVAS_VIEW_FOOTER_RE = new RegExp(
  `\\n\\n---\\n\\n${CANVAS_VIEW_FOOTER_TOKEN}[^\\n]*(?:\\n(?:Selected:|On screen:|- )[^\\n]*)*`,
  "g"
)
// The attachments footer stops at its last item line, like the canvas view.
const ATTACHMENTS_FOOTER_RE = new RegExp(
  `\\n\\n---\\n\\n${ATTACHMENTS_FOOTER_TOKEN}[^\\n]*(?:\\n- [^\\n]*)*`,
  "g"
)
// The drafted-on footer is one line.
const DRAFTED_ON_FOOTER_RE = new RegExp(
  `\\n\\n---\\n\\n${DRAFTED_ON_FOOTER_TOKEN}[^\\n]*`,
  "g"
)
// One attachment line, exactly as `attachmentLine` emits it.
const ATTACHMENT_LINE_RE = /^- ("(?:[^"\\]|\\.)*") \(([^,()]+), (\d+) bytes\)$/

// One targeted-element detail line, exactly as `buildTargetedElementsFooter`
// emits it: `- <ref>: <route> — <selector> (frame: <frameLabel>)` (or
// `(mockup: …)` for an element in a Mockup) with an
// optional ` [layer: <id>]` app-only trailer. `ref` holds no `:` (it's a
// nanoid); `route` stops at the first ` — `; `selector` runs greedily up to the
// trailing ` (frame: …)` / ` (mockup: …)`, whose label may itself contain parens; `<id>` (also a
// nanoid) holds no `]`, so the trailer is unambiguous even then.
const TARGETED_ELEMENTS_LINE_RE =
  /^- ([^:]+): (.+?) — (.+) \((frame|mockup): (.*)\)(?: \[layer: ([^\]]+)\])?$/

/**
 * Parse a wire user message back into its turn metadata and clean body.
 * A no-op on a string that carries no prefixes: `planMode` is false,
 * `branch` is undefined, and `body` is the input unchanged.
 */
export function parseUserMessage(wire: string): ParsedUserMessage {
  let body = wire
  let planMode = false
  let branch: string | undefined

  let prEvent: PrEventMark | undefined
  const prEventMatch = body.match(PR_EVENT_PREFIX_RE)
  if (prEventMatch && PR_EVENT_KINDS.has(prEventMatch[2]!)) {
    prEvent = {
      number: Number(prEventMatch[1]),
      kind: prEventMatch[2] as PrEventKind,
      ...(prEventMatch[3] ? { detail: safeDecode(prEventMatch[3]) } : {}),
    }
    body = body.slice(prEventMatch[0].length)
  }

  const wakeMatch = body.match(WAKE_PREFIX_RE)
  const wakeFrom = wakeMatch?.[1]
  if (wakeMatch) body = body.slice(wakeMatch[0].length)

  const delegatedMatch = body.match(DELEGATED_PREFIX_RE)
  const delegatedFrom = delegatedMatch?.[1]
  if (delegatedMatch) body = body.slice(delegatedMatch[0].length)

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
  body = body.replace(CANVAS_VIEW_FOOTER_RE, "")
  body = body.replace(ATTACHMENTS_FOOTER_RE, "")
  body = body.replace(DRAFTED_ON_FOOTER_RE, "")
  const hadReferencedDocs = REFERENCED_DOCS_FOOTER_RE.test(body)
  const hadTargetedElements = TARGETED_ELEMENTS_FOOTER_RE.test(body)
  if (hadReferencedDocs) {
    body = body.replace(REFERENCED_DOCS_FOOTER_RE, "")
  }
  if (hadTargetedElements) {
    body = body.replace(TARGETED_ELEMENTS_FOOTER_RE, "")
  }

  return {
    ...(prEvent ? { prEvent } : {}),
    ...(wakeFrom ? { wakeFrom } : {}),
    ...(delegatedFrom ? { delegatedFrom } : {}),
    planMode,
    branch,
    body,
    hadReferencedDocs,
    hadTargetedElements,
  }
}

/** `decodeURIComponent`, keeping the raw text when it isn't valid encoding. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
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
        frameLabel: m[5],
        // `undefined` on a legacy line with no `[layer: …]` trailer.
        iframeLayerId: m[6],
        ...(m[4] === "mockup" ? { layerKind: "mockup" as const } : {}),
      })
    }
  }
  return out
}

/**
 * Recover the attachments from every `Attached files:` footer in a wire user
 * message (a message joined from several Steers may carry more than one), in
 * order. Lines that don't match the canonical shape are skipped.
 */
export function parseAttachmentsFooter(wire: string): MessageAttachment[] {
  const out: MessageAttachment[] = []
  for (const match of wire.matchAll(ATTACHMENTS_FOOTER_RE)) {
    for (const line of match[0].split("\n")) {
      const m = line.match(ATTACHMENT_LINE_RE)
      if (!m) continue
      try {
        const path = JSON.parse(m[1]!) as unknown
        if (typeof path !== "string") continue
        out.push({ path, mediaType: m[2]!, size: Number(m[3]) })
      } catch {
        // Not a JSON string after all: skip the line.
      }
    }
  }
  return out
}
