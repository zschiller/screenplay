import * as Y from "yjs"
import { titleHeading } from "@/lib/document-markdown"

/**
 * Resolve a Document layer's body fragment from the room Y.Doc. Every Markdown
 * Layer's body lives in a `Y.XmlFragment` keyed `markdown-layer-{id}` (see
 * `apps/app/CONTEXT.md`). This is the single owner of that key string — the key
 * is the persisted identity of a document in every existing room, so call sites
 * resolve through here rather than constructing it inline.
 *
 * The body as markdown, for agents, is `document-markdown.ts`.
 */
export function documentFragment(doc: Y.Doc, id: string): Y.XmlFragment {
  return doc.getXmlFragment(`markdown-layer-${id}`)
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
    fragment.push([titleHeading()])
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
      heading = titleHeading()
      fragment.insert(0, [heading])
    }
    if (title.length > 0) {
      const t = new Y.XmlText()
      t.insert(0, title)
      heading.insert(0, [t])
    }
  })
}

function xmlElementText(el: Y.XmlElement): string {
  let out = ""
  const len = el.length
  for (let i = 0; i < len; i++) {
    const child = el.get(i)
    // The delta, not `toString()`, which writes marks as XML tags.
    if (child instanceof Y.XmlText) {
      for (const d of child.toDelta() as Array<{ insert: unknown }>) {
        if (typeof d.insert === "string") out += d.insert
      }
    } else if (child instanceof Y.XmlElement) out += xmlElementText(child)
  }
  return out
}
