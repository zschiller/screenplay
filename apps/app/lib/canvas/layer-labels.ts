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
 * On-screen height a name needs clear above its Layer: the 4px gap and the
 * 20px row its chat sets, leaving out the row's empty leading on top.
 */
const LAYER_LABEL_SCREEN_HEIGHT = 20

/**
 * On-screen height a group label adds above its leftmost member's name: the
 * 20px row its chat sets and its 2px gap.
 */
const GROUP_LABEL_SCREEN_HEIGHT = 22

/**
 * The Layers whose labels hide at `zoom`: where the Layer is too narrow on
 * screen, and far out (below the detail zoom) also where the label would sit
 * on top of another Layer, so tightly stacked rows don't print names over the
 * frames above them.
 */
export function hiddenLayerLabels(
  layouts: Iterable<Rect & { id: string }>,
  zoom: number
): ReadonlySet<string> {
  const rects = [...layouts]
  const hidden = new Set<string>()
  for (const r of rects) {
    if (!fitsLabel(r, rects, zoom, LAYER_LABEL_SCREEN_HEIGHT)) hidden.add(r.id)
  }
  return hidden
}

/**
 * The Groups whose labels hide at `zoom`, by the same rule as Layer names: a
 * group label sits above its leftmost member's name, so it hides with that
 * name, and far out also where the two lines together would sit on top of
 * another Layer. `leaders` maps each labelled Group to its leftmost member.
 */
export function hiddenGroupLabels(
  layouts: Iterable<Rect & { id: string }>,
  leaders: ReadonlyMap<string, string>,
  zoom: number
): ReadonlySet<string> {
  const rects = [...layouts]
  const hidden = new Set<string>()
  for (const [groupId, leaderId] of leaders) {
    const r = rects.find((o) => o.id === leaderId)
    if (
      !r ||
      !fitsLabel(
        r,
        rects,
        zoom,
        LAYER_LABEL_SCREEN_HEIGHT + GROUP_LABEL_SCREEN_HEIGHT
      )
    ) {
      hidden.add(groupId)
    }
  }
  return hidden
}

/**
 * Whether a label `screenHeight` px tall fits above `r`: its Layer is wide
 * enough on screen, and far out the label clears every other Layer.
 */
function fitsLabel(
  r: Rect & { id: string },
  rects: ReadonlyArray<Rect & { id: string }>,
  zoom: number,
  screenHeight: number
): boolean {
  if (r.width * zoom < LAYER_LABEL_MIN_SCREEN_WIDTH - 1e-3) return false
  if (showsLayerDetail(zoom)) return true
  const stripHeight = screenHeight / zoom
  const strip = {
    x: r.x,
    y: r.y - stripHeight,
    width: r.width,
    height: stripHeight,
  }
  return !rects.some((o) => o.id !== r.id && overlaps(strip, o))
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}
