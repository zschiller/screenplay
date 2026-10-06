/**
 * Canvas Camera — the React-free decision core for the camera's zoom-to-fit
 * math: given a target rect (or element bounds) and the viewport size, compute
 * the pan/zoom transform that frames the target with padding.
 *
 * The controller (`useCanvasCamera`) owns the live `react-zoom-pan-pinch`
 * transform and applies the result; this module is the testable geometry behind
 * "fit this rect into the viewport" — pinned by fixtures against plain numbers,
 * the same way Snap and Layout are.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** A pan/zoom transform in the `react-zoom-pan-pinch` convention. */
export interface CameraTransform {
  x: number
  y: number
  zoom: number
}

export interface FitOptions {
  /** Screen-space padding kept around the target on every side. */
  padding: number
  /** Upper zoom clamp — a small target never zooms in past this. */
  maxZoom: number
  /** Optional lower zoom clamp — a huge target never zooms out below this. */
  minZoom?: number
}

/**
 * The zoom level that fits a `contentW × contentH` target into the viewport
 * with `padding` on each side, clamped to `[minZoom?, maxZoom]`. The smaller of
 * the width- and height-constrained scales wins so the whole target fits.
 */
export function fitScale(
  contentW: number,
  contentH: number,
  viewport: ViewportSize,
  options: FitOptions
): number {
  const { padding, maxZoom, minZoom } = options
  let scale = Math.min(
    (viewport.width - padding * 2) / contentW,
    (viewport.height - padding * 2) / contentH,
    maxZoom
  )
  if (minZoom !== undefined) scale = Math.max(minZoom, scale)
  return scale
}

/**
 * The transform that fits `rect` (world-space) centered in the viewport with
 * padding. The zoom is {@link fitScale}; the position places the rect's center
 * at the viewport's center for that zoom.
 */
export function fitRectToViewport(
  rect: Rect,
  viewport: ViewportSize,
  options: FitOptions
): CameraTransform {
  const scale = fitScale(rect.width, rect.height, viewport, options)
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  return {
    x: viewport.width / 2 - centerX * scale,
    y: viewport.height / 2 - centerY * scale,
    zoom: scale,
  }
}

/**
 * The stops the zoom-in / zoom-out buttons and `⌘=` / `⌘-` step through,
 * spanning `ZOOM_MIN`..`ZOOM_MAX`.
 */
export const ZOOM_LEVELS = [
  0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16,
] as const

/**
 * The next zoom stop above (`direction` 1) or below (-1) `current`, staying at
 * the last stop when there's nowhere further to go. A zoom already sitting
 * between stops (after a pinch) goes to the neighbouring stop, not past it.
 */
export function stepZoom(
  current: number,
  direction: 1 | -1,
  levels: readonly number[] = ZOOM_LEVELS
): number {
  const EPS = 1e-3
  if (direction > 0) {
    return levels.find((l) => l > current * (1 + EPS)) ?? levels.at(-1)!
  }
  return (
    [...levels].reverse().find((l) => l < current * (1 - EPS)) ?? levels[0]!
  )
}

/**
 * The transform that changes the zoom to `zoom` while keeping the world point
 * under screen-space `point` fixed (e.g. the viewport center).
 */
export function zoomAtPoint(
  transform: CameraTransform,
  zoom: number,
  point: { x: number; y: number }
): CameraTransform {
  const ratio = zoom / transform.zoom
  return {
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
    zoom,
  }
}

/** The smallest rect enclosing every rect, or `null` when there are none. */
export function unionRect(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  if (!isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Below this zoom, Layer labels shrink to the bare name (see
 * `hiddenLayerLabels`).
 */
export const LAYER_DETAIL_MIN_ZOOM = 0.25

export function showsLayerDetail(zoom: number): boolean {
  return zoom >= LAYER_DETAIL_MIN_ZOOM - 1e-3
}

/**
 * The shortest side, in screen px, a Layer needs to keep its resize handles.
 * Handles keep a constant screen size, so on a smaller tile their hit zones
 * would swallow it and leave nothing to grab for a move. Hiding per Layer
 * rather than at one zoom keeps a big frame resizable when zoomed far out.
 */
export const RESIZE_HANDLES_MIN_SCREEN_SIZE = 48

export function showsResizeHandles(
  width: number,
  height: number,
  zoom: number
): boolean {
  return Math.min(width, height) * zoom >= RESIZE_HANDLES_MIN_SCREEN_SIZE - 1e-3
}
