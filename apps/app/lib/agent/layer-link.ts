/**
 * Markdown links a Coordinator reply names a frame, document or mockup with:
 * `[title](frame:<id>)`, `[title](document:<id>)`, `[title](mockup:<id>)`,
 * as it names a Workspace with `[title](workspace:<id>)`. The chat draws each
 * as an inline reference (its icon and name), and in the Coordinator panel a
 * click shows it on the canvas.
 */

export const LAYER_LINK_KINDS = ["frame", "document", "mockup"] as const

export type LayerLinkKind = (typeof LAYER_LINK_KINDS)[number]

/** A link to a frame, document or mockup, `[title](<kind>:<id>)`. */
export function layerLink(
  kind: LayerLinkKind,
  title: string,
  id: string
): string {
  return `[${title.replace(/[[\]]/g, "")}](${kind}:${id})`
}

/** The frame, document or mockup a link's href names, or null. */
export function parseLayerLink(
  href: string
): { kind: LayerLinkKind; id: string } | null {
  const colon = href.indexOf(":")
  if (colon < 1) return null
  const kind = href.slice(0, colon) as LayerLinkKind
  const id = href.slice(colon + 1)
  return LAYER_LINK_KINDS.includes(kind) && id ? { kind, id } : null
}
