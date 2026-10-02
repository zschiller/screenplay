import { showsLayerDetail } from "./camera"

type Rect = { x: number; y: number; width: number; height: number }

/**
 * The narrowest a Layer can be on screen, in px, and still show its label.
 * Labels keep a constant size and truncate to their Layer's width, so a label
 * hides once its Layer is too narrow to fit a readable name, the way Figma's
 * frame names do, rather than every label hiding at one zoom.
 */
export const LAYER_LABEL_MIN_SCREEN_WIDTH = 64

/**
 * On-screen height a compact label needs clear above its Layer: the 4px gap
 * and the 12px text, leaving out the row's empty leading on top.
 */
const COMPACT_LABEL_SCREEN_HEIGHT = 18

/**
 * The Layers whose labels hide at `zoom`. Far out (below the detail zoom) a
 * label is just the Layer's name, and it also hides where it would sit on top
 * of another Layer, so tightly stacked rows don't print names over the frames
 * above them.
 */
export function hiddenLayerLabels(
  layouts: Iterable<Rect & { id: string }>,
  zoom: number
): ReadonlySet<string> {
  const rects = [...layouts]
  const hidden = new Set<string>()
  const compact = !showsLayerDetail(zoom)
  const stripHeight = COMPACT_LABEL_SCREEN_HEIGHT / zoom
  for (const r of rects) {
    if (r.width * zoom < LAYER_LABEL_MIN_SCREEN_WIDTH - 1e-3) {
      hidden.add(r.id)
      continue
    }
    if (!compact) continue
    const strip = {
      x: r.x,
      y: r.y - stripHeight,
      width: r.width,
      height: stripHeight,
    }
    if (rects.some((o) => o.id !== r.id && overlaps(strip, o))) {
      hidden.add(r.id)
    }
  }
  return hidden
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}
