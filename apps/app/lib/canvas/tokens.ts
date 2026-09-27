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
