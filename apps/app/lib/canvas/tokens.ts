/**
 * Canvas colour tokens (issue #719) — the names the drawn overlays read.
 *
 * The values live in `app/globals.css` beside the canvas layer scale, as CSS
 * custom properties, so the DOM titles (`text-canvas-selection`) and the 2D
 * canvases that draw selection, snap, inspect and merge chrome resolve the same
 * colour, and a theme can retune one without touching either.
 */
export const CANVAS_COLOR = {
  /** Local selection: frame outlines, handles, union rect, marquee, drafts. */
  selection: "--canvas-selection",
  /** Edge/centre snap guides and a resize locked onto a device preset. */
  snap: "--canvas-snap",
  /** The element under the pointer while commenting or picking a target. */
  inspect: "--canvas-inspect",
  /** The element a hovered composer / message token references. */
  highlight: "--canvas-highlight",
  /** The drop slot a dragged Group would merge into. */
  groupMerge: "--canvas-group-merge",
  /** Comment pins and the outline on the element an open thread is about. */
  comment: "--canvas-comment",
  /** A frame's empty body, for a drawn box that stands in for one. */
  frameBody: "--canvas-frame-body",
  /** Each Layer's resting hairline, drawn beneath the content. */
  layerEdge: "--canvas-layer-edge",
  /** The pixel grid's lines, drawn over the content when zoomed far in. */
  pixelGrid: "--canvas-pixel-grid",
} as const

export type CanvasColorToken = (typeof CANVAS_COLOR)[keyof typeof CANVAS_COLOR]

const resolved = new Map<string, string>()

/**
 * Read a colour custom property as seen from `el` and resolve it to the
 * `rgb()` form a 2D context accepts everywhere (older WebKit canvases reject
 * `oklch()` strings). `el` must be in the document so theme classes apply.
 *
 * Resolution goes through a throwaway element, so results are memoised by the
 * property's raw value — a theme switch changes the raw value and misses.
 */
export function resolveCanvasColor(el: HTMLElement, varName: string): string {
  // Overlays redraw on every pointer move, and reading a computed style then
  // forces a style pass over whatever the move just changed. The value only
  // changes with the theme, so each element's answer is kept until the root's
  // classes or style (where the theme lives) or the colour scheme change.
  watchTheme()
  let byVar = perElement.get(el)
  if (!byVar) perElement.set(el, (byVar = new Map()))
  const known = byVar.get(varName)
  if (known) return known
  const color = resolveUncached(el, varName)
  // Unset (not yet styled) isn't kept: the next draw asks again.
  if (color !== "transparent") byVar.set(varName, color)
  return color
}

let perElement = new WeakMap<HTMLElement, Map<string, string>>()
let watching = false

function watchTheme() {
  if (watching || typeof MutationObserver === "undefined") return
  watching = true
  const forget = () => {
    perElement = new WeakMap()
  }
  new MutationObserver(forget).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  })
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener?.("change", forget)
}

function resolveUncached(el: HTMLElement, varName: string): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim()
  if (!raw) return "transparent"
  const hit = resolved.get(raw)
  if (hit) return hit
  const probe = document.createElement("div")
  probe.style.color = raw
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).color
  document.body.removeChild(probe)
  resolved.set(raw, color)
  return color
}
