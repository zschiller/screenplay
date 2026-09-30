import * as Y from "yjs"

/**
 * Resolve a Mockup Layer's page from the room Y.Doc. Every Mockup Layer's HTML
 * lives in a `Y.Text` keyed `mockup-layer-{id}` (see `apps/app/CONTEXT.md`),
 * beside its record the way a Markdown Layer's body sits beside its record.
 * This is the single owner of that key string.
 */
export function mockupHtml(doc: Y.Doc, id: string): Y.Text {
  return doc.getText(`mockup-layer-${id}`)
}

/** Replace a mockup's whole page with `html`, as one change. */
export function writeMockupHtml(text: Y.Text, html: string): void {
  const write = () => {
    if (text.length > 0) text.delete(0, text.length)
    if (html) text.insert(0, html)
  }
  if (text.doc) text.doc.transact(write)
  else write()
}
