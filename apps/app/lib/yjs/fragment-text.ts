import * as Y from "yjs"
import { getSchema } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { MarkdownManager } from "@tiptap/markdown"
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap"

/**
 * Resolve a Document layer's body fragment from the room Y.Doc. Every Markdown
 * Layer's body lives in a `Y.XmlFragment` keyed `markdown-layer-{id}` (see
 * `apps/app/CONTEXT.md`). This is the single owner of that key string — the key
 * is the persisted identity of a document in every existing room, so call sites
 * resolve through here rather than constructing it inline.
 */
export function documentFragment(doc: Y.Doc, id: string): Y.XmlFragment {
  return doc.getXmlFragment(`markdown-layer-${id}`)
}

/**
 * Serialize a TipTap-managed Y.XmlFragment to plain text. Walks the fragment
 * tree and joins paragraphs / list items / etc. with newlines so the result
 * reads cleanly when handed to an LLM as context.
 *
 * The reverse direction — `writeMarkdownToFragment` and
 * `replaceFragmentBodyPreservingTitle` — runs the agent's markdown through
 * Tiptap's official `MarkdownManager` (CommonMark via marked-js), converts
 * the resulting Tiptap JSON to ProseMirror nodes against the same schema the
 * editor uses, and lands them as `Y.XmlElement`s via `@tiptap/y-tiptap`'s
 * `prosemirrorJSONToYXmlFragment`. Inline marks (bold/italic/links/code) and
 * richer blocks (blockquotes, ordered lists, code blocks) round-trip
 * correctly — anything StarterKit's markdown handlers cover, ours covers.
 */
export function fragmentToPlainText(
  node: Y.XmlFragment | Y.XmlElement
): string {
  const lines: string[] = []
  collectLines(node, lines)
  return lines.join("\n").trim()
}

/**
 * Seed an empty document fragment with just the schema-required title
 * heading. The body isn't pre-seeded — that way a fresh doc opens with the
 * cursor in the title (focus "end" lands at the end of the heading) instead
 * of in a stray empty paragraph below an empty title. Pressing Enter inside
 * the title creates the body paragraph on demand.
 */
export function seedDocumentFragment(fragment: Y.XmlFragment): void {
  const doc = fragment.doc
  if (!doc) return
  if (fragment.length > 0) return
  doc.transact(() => {
    if (fragment.length > 0) return
    fragment.push([makeHeading(1)])
  })
}

/** Read the plain-text content of the first heading (the title). Returns
 *  the empty string when the fragment hasn't been seeded yet. */
export function getFragmentTitle(fragment: Y.XmlFragment): string {
  const first = fragment.length > 0 ? fragment.get(0) : undefined
  if (!(first instanceof Y.XmlElement) || first.nodeName !== "heading")
    return ""
  return xmlElementText(first)
}

/** Plain-text serialization of everything below the title heading. Used
 *  by tools that want to operate on body content without disturbing the
 *  title (e.g. `append_to_document_body`, agent context loaders). */
export function fragmentBodyToPlainText(fragment: Y.XmlFragment): string {
  const lines: string[] = []
  const len = fragment.length
  // Skip the title heading at index 0; collect from index 1 onward.
  const startAt = len > 0 && isHeading(fragment.get(0)) ? 1 : 0
  for (let i = startAt; i < len; i++) {
    const child = fragment.get(i)
    if (child instanceof Y.XmlText) {
      const t = child.toString()
      if (t.length > 0) lines.push(t)
    } else if (child instanceof Y.XmlElement) {
      const before = lines.length
      collectLines(child, lines)
      if (
        lines.length > before &&
        (child.nodeName === "paragraph" ||
          child.nodeName === "heading" ||
          child.nodeName === "blockquote" ||
          child.nodeName === "codeBlock")
      ) {
        lines.push("")
      }
    }
  }
  return lines.join("\n").trim()
}

function isHeading(node: unknown): boolean {
  return node instanceof Y.XmlElement && node.nodeName === "heading"
}

/**
 * Replace the text of the document's title (the first heading). Prepends a
 * new heading when the fragment is empty or doesn't start with one. Body
 * blocks below the heading are untouched.
 */
export function setFragmentTitle(fragment: Y.XmlFragment, title: string): void {
  const doc = fragment.doc
  if (!doc) return
  doc.transact(() => {
    const first = fragment.length > 0 ? fragment.get(0) : undefined
    let heading: Y.XmlElement
    if (first instanceof Y.XmlElement && first.nodeName === "heading") {
      heading = first
      while (heading.length > 0) heading.delete(0, 1)
    } else {
      heading = makeHeading(1)
      fragment.insert(0, [heading])
    }
    if (title.length > 0) {
      const t = new Y.XmlText()
      t.insert(0, title)
      heading.insert(0, [t])
    }
  })
}

/**
 * Replace everything below the title with new body content parsed from the
 * agent's lightweight markdown. The title heading is preserved verbatim so
 * the agent can rewrite the body without clobbering the page title (which
 * has its own dedicated `set_document_title` tool).
 */
export function replaceFragmentBodyPreservingTitle(
  fragment: Y.XmlFragment,
  markdown: string
): void {
  const doc = fragment.doc
  if (!doc) return
  doc.transact(() => {
    // Make sure the schema's required title heading exists. If the fragment
    // is empty or the first node isn't a heading, leave a blank one so the
    // editor still has a valid first-child.
    const first = fragment.length > 0 ? fragment.get(0) : undefined
    if (!(first instanceof Y.XmlElement) || first.nodeName !== "heading") {
      fragment.insert(0, [makeHeading(1)])
    }
    while (fragment.length > 1) fragment.delete(1, 1)

    for (const block of parseMarkdownToBlocks(markdown)) {
      fragment.push([block])
    }
    // Schema requires `heading block*` — we just guaranteed a heading at index 0,
    // but if the markdown was empty we also need a body paragraph for the
    // editor to land its cursor in.
    if (fragment.length === 1) {
      fragment.push([new Y.XmlElement("paragraph")])
    }
  })
}

function xmlElementText(el: Y.XmlElement): string {
  let out = ""
  const len = el.length
  for (let i = 0; i < len; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlText) out += child.toString()
    else if (child instanceof Y.XmlElement) out += xmlElementText(child)
  }
  return out
}

/**
 * Tiptap's `MarkdownManager` parses CommonMark via marked-js into Tiptap JSON;
 * `prosemirrorJSONToYXmlFragment` then materializes that JSON as `Y.XmlElement`
 * nodes against the same schema the editor uses. The shared schema/manager
 * are derived once from a vanilla StarterKit (with `undoRedo` off — the
 * undoRedo extension hooks into the editor's history and isn't relevant for
 * server-side parsing). Using the editor's `DocumentWithTitle` here would
 * reject body-only markdown that doesn't lead with a heading, so we keep the
 * permissive default `Document` with `block+`.
 */
const markdownExtensions = [StarterKit.configure({ undoRedo: false })]
const markdownSchema = getSchema(markdownExtensions)
const markdownManager = new MarkdownManager({ extensions: markdownExtensions })

/**
 * Parse a markdown string into an array of `Y.XmlElement` body blocks ready
 * to push into a real document fragment. We route through a throwaway
 * `Y.Doc` because `prosemirrorJSONToYXmlFragment` walks the existing fragment
 * to diff updates — running it directly on the live fragment would clobber
 * any concurrent edits in the title slot. Cloning each child detaches it
 * from the temp doc so we can `push` it into the real fragment.
 */
function parseMarkdownToBlocks(markdown: string): Y.XmlElement[] {
  const json = markdownManager.parse(markdown)
  const tempDoc = new Y.Doc()
  const tempFragment = tempDoc.getXmlFragment("temp")
  prosemirrorJSONToYXmlFragment(markdownSchema, json, tempFragment)
  const blocks: Y.XmlElement[] = []
  for (let i = 0; i < tempFragment.length; i++) {
    const child = tempFragment.get(i)
    if (child instanceof Y.XmlElement) blocks.push(child.clone())
  }
  return blocks
}

/**
 * Replace the contents of a Y.XmlFragment with Tiptap-compatible XmlElement
 * nodes parsed from agent-emitted markdown via Tiptap's `MarkdownManager`.
 * Runs inside one `doc.transact()` so peers see a single update on the wire
 * and a single undo step.
 */
export function writeMarkdownToFragment(
  fragment: Y.XmlFragment,
  text: string
): void {
  const doc = fragment.doc
  if (!doc) return
  doc.transact(() => {
    while (fragment.length > 0) fragment.delete(0, 1)

    for (const block of parseMarkdownToBlocks(text)) {
      fragment.push([block])
    }

    // Schema requires `heading block*` — make sure the first node is a
    // heading even when the agent's input didn't lead with one.
    const first = fragment.length > 0 ? fragment.get(0) : undefined
    if (!(first instanceof Y.XmlElement) || first.nodeName !== "heading") {
      fragment.insert(0, [makeHeading(1)])
    }
    if (fragment.length === 1) {
      fragment.push([new Y.XmlElement("paragraph")])
    }
  })
}

/** Heading nodes must store `level` as a number — TipTap's heading renderer
 *  checks `levels.includes(node.attrs.level)` against `[1..6]` (numbers), so
 *  a string `"2"` would fail the check and silently fall back to h1. */
function makeHeading(level: number): Y.XmlElement {
  const heading = new Y.XmlElement("heading")
  // setAttribute is typed as (string, string), but Yjs stores any ValueType
  // and the heading extension needs `level` as a number — see comment above.
  ;(heading as Y.XmlElement<{ level: number }>).setAttribute("level", level)
  return heading
}

function collectLines(node: Y.XmlFragment | Y.XmlElement, out: string[]): void {
  const len = node.length
  for (let i = 0; i < len; i++) {
    const child = node.get(i)
    if (child instanceof Y.XmlText) {
      // Each top-level XmlText goes on its own line so adjacent paragraphs
      // don't run together.
      const t = child.toString()
      if (t.length > 0) out.push(t)
    } else if (child instanceof Y.XmlElement) {
      // Mention nodes are inline and carry their text in attrs (TipTap's
      // Mention extension stores the picked label there, not as XmlText
      // children). Render them as `@<label>` so the agent sees the
      // human-readable reference.
      if (child.nodeName === "mention") {
        const attrs = child.getAttributes() as Record<string, unknown>
        const label =
          (attrs.label as string | undefined) ??
          (attrs.id as string | undefined)
        if (label) out.push(`@${label}`)
        continue
      }
      // Block-level elements (paragraph, heading, listItem, etc.) collect
      // their own line; inline elements just contribute text.
      const before = out.length
      collectLines(child, out)
      // Add an empty line after blockquote / heading / paragraph blocks to
      // visually separate them, matching common markdown spacing.
      if (
        out.length > before &&
        (child.nodeName === "paragraph" ||
          child.nodeName === "heading" ||
          child.nodeName === "blockquote" ||
          child.nodeName === "codeBlock")
      ) {
        // Push a soft break — collapsed at the end via `.trim()` if trailing.
        out.push("")
      }
    }
  }
}
