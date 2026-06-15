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
