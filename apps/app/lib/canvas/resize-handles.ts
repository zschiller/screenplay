import type { ResizeEdge } from "@/hooks/use-layer-resize"

/** Side of a drawn resize handle square, in screen px. */
export const RESIZE_HANDLE_SIZE = 8

/** Thickness of an edge grab zone, in screen px. */
export const RESIZE_EDGE_ZONE = 6

/** Side of a corner grab zone, in screen px. */
export const RESIZE_CORNER_ZONE = 12

/**
 * The resize handles drawn on a selected Layer that is `width` × `height` on
 * screen. Like Figma, the drawing is the only thing that hides: a handle
 * drops only where it would overlap another, and the grab zones stay live
 * at every size (`resizeGrabZones`).
 *
 * Corners overlap each other once a side is shorter than a handle. A side's
 * middle handle overlaps its corners once that side is shorter than two.
 */
export function visibleResizeHandles(
  width: number,
  height: number
): ResizeEdge[] {
  const hs = RESIZE_HANDLE_SIZE - 1e-3
  if (width < hs || height < hs) return []
  const handles: ResizeEdge[] = ["nw", "ne", "sw", "se"]
  if (width >= 2 * hs) handles.push("n", "s")
  if (height >= 2 * hs) handles.push("w", "e")
  return handles
}

/** How far a grab zone reaches into and out of the Layer, in screen px. */
export interface GrabReach {
  inside: number
  outside: number
}

/**
 * How far the corner and edge grab zones reach into and out of a Layer that
 * is `width` × `height` on screen. Each zone keeps its full size, centred on
 * the bounds, until the Layer gets small; then it reaches at most a quarter
 * of the way in and grows outward instead, so the middle half stays free
 * to move the Layer.
 */
export function resizeGrabZones(
  width: number,
  height: number
): {
  corner: { x: GrabReach; y: GrabReach }
  edge: { x: GrabReach; y: GrabReach }
} {
  const reach = (size: number, side: number): GrabReach => {
    const inside = Math.max(0, Math.min(size / 2, side / 4))
    return { inside, outside: size - inside }
  }
  return {
    corner: {
      x: reach(RESIZE_CORNER_ZONE, width),
      y: reach(RESIZE_CORNER_ZONE, height),
    },
    edge: {
      x: reach(RESIZE_EDGE_ZONE, width),
      y: reach(RESIZE_EDGE_ZONE, height),
    },
  }
}
