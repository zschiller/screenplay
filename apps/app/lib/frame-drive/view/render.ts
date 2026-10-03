import type { FrameSnapshot } from "@/lib/frame-drive/mac/protocol"
import { MOCKUP_CSP } from "@/lib/yjs/mockup-html"

/**
 * A mockup's snapshot as one page to render for a screenshot (#1391): its
 * markup and CSS under the Mockup's own Content Security Policy, so nothing
 * loads from the network, scrolled where the person's view is. The markup
 * carries no scripts (the bridge strips them); the one script here only
 * scrolls.
 */
export function snapshotDocument(snapshot: FrameSnapshot): string {
  const { x, y } = snapshot.scroll
  return [
    "<!doctype html>",
    `<html${attrs(snapshot.htmlAttributes)}><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">`,
    '<meta charset="utf-8">',
    `<style>${snapshot.css.replace(/<\/style/gi, "<\\/style")}</style>`,
    `</head><body${attrs(snapshot.bodyAttributes)}>`,
    snapshot.markup,
    `<script>scrollTo(${Number(x) || 0}, ${Number(y) || 0})</script>`,
    "</body></html>",
  ].join("")
}

function attrs(serialized: string): string {
  return serialized ? ` ${serialized}` : ""
}
