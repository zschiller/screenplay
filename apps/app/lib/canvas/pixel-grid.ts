/**
 * The pixel grid: a hairline around every canvas pixel once zoomed far in, so
 * you can see where each pixel of a page lands, like Figma's.
 *
 * Figma shows it from 400% and it fades in as you keep zooming: a 4px cell
 * is too dense to read at full strength. Here it starts at 400% and reaches
 * full strength at 800%.
 */

/** The zoom the pixel grid starts to show at. */
export const PIXEL_GRID_MIN_ZOOM = 4

/** The zoom the pixel grid reaches full strength at. */
export const PIXEL_GRID_FULL_ZOOM = 8

/** How strongly the grid draws at `zoom`: 0 below 400%, 1 from 800%. */
export function pixelGridOpacity(zoom: number): number {
  if (zoom <= PIXEL_GRID_MIN_ZOOM) return 0
  if (zoom >= PIXEL_GRID_FULL_ZOOM) return 1
  return (
    (zoom - PIXEL_GRID_MIN_ZOOM) / (PIXEL_GRID_FULL_ZOOM - PIXEL_GRID_MIN_ZOOM)
  )
}

/**
 * Where the grid's lines fall along one axis of the view, in whole device
 * pixels: one at each canvas pixel's edge, from `offset` (the camera's
 * position on that axis, in CSS px) every `zoom` CSS px across `extent` CSS
 * px. Each is rounded to a device pixel so it draws as one sharp device pixel
 * line, the same pixel the content's own edge lands on.
 */
export function pixelGridLines(
  offset: number,
  zoom: number,
  extent: number,
  dpr: number
): number[] {
  const lines: number[] = []
  const first = Math.ceil(-offset / zoom)
  const last = Math.floor((extent - offset) / zoom)
  const limit = Math.round(extent * dpr)
  for (let k = first; k <= last; k++) {
    const at = Math.round((offset + k * zoom) * dpr)
    if (at >= 0 && at < limit) lines.push(at)
  }
  return lines
}
