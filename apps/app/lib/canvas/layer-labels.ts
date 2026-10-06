type Rect = { x: number; y: number; width: number; height: number }

/**
 * The narrowest a Layer can be on screen, in px, and still show its label.
 * Labels keep a constant size and truncate to their Layer's width, so a label
 * hides once its Layer is too narrow to fit a readable name, the way Figma's
 * frame names do, rather than every label hiding at one zoom.
 */
export const LAYER_LABEL_MIN_SCREEN_WIDTH = 64

/**
 * Whether a Layer `width` canvas units wide shows its label at `zoom`: only
 * its own width on screen decides, never the room above it or the zoom alone,
 * so Layers of one size always agree. A group label sits in its leftmost
 * member's label and shows with it.
 */
export function showsLayerLabel(width: number, zoom: number): boolean {
  return width * zoom >= LAYER_LABEL_MIN_SCREEN_WIDTH - 1e-3
}

/**
 * The width from `r`'s left edge to the furthest right edge of `rects`: the
 * room a group label on `r` has across its Group.
 */
export function widthAcross(r: Rect, rects: readonly Rect[]): number {
  return Math.max(r.width, ...rects.map((o) => o.x + o.width - r.x))
}
