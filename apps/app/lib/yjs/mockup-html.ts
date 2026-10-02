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

/**
 * The Content Security Policy every Mockup page runs under (#1309): its own
 * inline styles, scripts and data/blob images and fonts, and nothing from the
 * network.
 */
export const MOCKUP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

/**
 * A Mockup page as its frame's `srcdoc`: the page with {@link MOCKUP_CSP} as
 * the first thing in its head, so no script, style or image it names can load
 * from the network, then `runtime` (the DOM bridge and knobs runtime,
 * `MOCKUP_RUNTIME_JS`) as an inline script, so it runs before the page's own
 * scripts. The policy goes after any doctype, so the page keeps its rendering
 * mode.
 */
export function mockupSrcDoc(html: string, runtime = ""): string {
  const prelude =
    `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">` +
    (runtime
      ? `<script>${runtime.replace(/<\/script/gi, "<\\/script")}</script>`
      : "")
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return splice(html, head.index + head[0].length, prelude)
  const root = /<html(\s[^>]*)?>/i.exec(html)
  if (root) {
    return splice(html, root.index + root[0].length, `<head>${prelude}</head>`)
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return splice(html, doctype ? doctype[0].length : 0, prelude)
}

function splice(s: string, at: number, insert: string): string {
  return s.slice(0, at) + insert + s.slice(at)
}
