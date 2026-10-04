import * as Y from "yjs"

import {
  mockupRefs,
  swapMockupRefs,
  type MockupResources,
} from "@/lib/mockup-refs"

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
 * network. Scripts and styles may also come from `blob:` URLs, which only
 * the page itself can make: its references' (#1643).
 */
export const MOCKUP_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data:; media-src data: blob:"

/**
 * A Mockup page as its frame's `srcdoc`: the page with {@link MOCKUP_CSP} as
 * the first thing in its head, so no script, style or image it names can load
 * from the network, then `runtime` (the DOM bridge and knobs runtime,
 * `MOCKUP_RUNTIME_JS`) as an inline script, so it runs before the page's own
 * scripts. The policy goes after any doctype, so the page keeps its rendering
 * mode.
 *
 * A page that names `skill:` or `files:` references (`lib/mockup-refs.ts`)
 * gets them from `resources`, as `blob:` URLs. The canvas's own `blob:` URLs
 * can't load in the page's opaque origin, so the page makes them: a loader
 * script after the runtime holds the page and each resource's bytes, turns
 * the bytes into `blob:` URLs, and writes the page in with its references
 * swapped for them, so every script and stylesheet still loads in order
 * before the parser goes on. A reference `resources` doesn't resolve becomes
 * an empty resource.
 */
export function mockupSrcDoc(
  html: string,
  runtime = "",
  resources: MockupResources = {}
): string {
  const prelude =
    `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">` +
    (runtime ? inlineScript(runtime) : "")
  const refs = mockupRefs(html)
  if (refs.length > 0) {
    // A srcdoc document never renders in quirks mode, so the page's own
    // doctype has nothing to keep; its `<html>` and `<body>` attributes
    // still land on the elements as it writes in.
    return `<!doctype html><html><head>${prelude}${inlineScript(refLoader(html, refs, resources))}`
  }
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return splice(html, head.index + head[0].length, prelude)
  const root = /<html(\s[^>]*)?>/i.exec(html)
  if (root) {
    return splice(html, root.index + root[0].length, `<head>${prelude}</head>`)
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return splice(html, doctype ? doctype[0].length : 0, prelude)
}

/** Where a reference's `blob:` URL goes in the page the loader writes. */
const REF_TOKEN = "about:screenplay-ref/"

/**
 * The script that writes the page in with its references as `blob:` URLs
 * made from `resources` (see {@link mockupSrcDoc}).
 */
function refLoader(
  html: string,
  refs: readonly string[],
  resources: MockupResources
): string {
  const page = swapMockupRefs(html, (ref) => REF_TOKEN + refs.indexOf(ref))
  const files = refs.map((ref) => {
    const found = resources[ref]
    return found ? [found.type, found.data] : ["", ""]
  })
  return `(function(){var f=${scriptJson(files)};var u=f.map(function(x){var s=atob(x[1]),b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return URL.createObjectURL(new Blob([b],{type:x[0]}))});document.write(${scriptJson(page)}.replace(/about:screenplay-ref\\/(\\d+)/g,function(_,i){return u[+i]}))})()`
}

/** `value` as JSON that can sit inside a `<script>` element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function inlineScript(js: string): string {
  return `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`
}

function splice(s: string, at: number, insert: string): string {
  return s.slice(0, at) + insert + s.slice(at)
}
