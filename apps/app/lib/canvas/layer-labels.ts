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

/** A labelled Group: its members, leftmost first. */
export interface LabelledGroup {
  memberIds: readonly string[]
}

/**
 * The Groups whose labels hide at `zoom`, by the same rule as Layer names: a
 * group label sits above its leftmost member's name, so it hides with that
 * name, and far out also where the two lines together would sit on top of
 * another Layer. The group label runs the Group's width, so that whole strip
 * must be clear.
 */
export function hiddenGroupLabels(
  layouts: Iterable<Rect & { id: string }>,
  groups: ReadonlyMap<string, LabelledGroup>,
  zoom: number
): ReadonlySet<string> {
  const rects = [...layouts]
  const hidden = new Set<string>()
  for (const [groupId, { memberIds }] of groups) {
    const r = rects.find((o) => o.id === memberIds[0])
    const members = rects.filter((o) => memberIds.includes(o.id))
    if (
      !r ||
      !fitsLabel(
        r,
        rects,
        zoom,
        LAYER_LABEL_SCREEN_HEIGHT + GROUP_LABEL_SCREEN_HEIGHT,
        members
      )
    ) {
      hidden.add(groupId)
    }
  }
  return hidden
}

/**
 * The width from `r`'s left edge to the furthest right edge of `rects`: the
 * room a group label on `r` has across its Group.
 */
export function widthAcross(r: Rect, rects: readonly Rect[]): number {
  return Math.max(r.width, ...rects.map((o) => o.x + o.width - r.x))
}

/**
 * Whether a label `screenHeight` px tall fits above `r`: its Layer is wide
 * enough on screen, and far out the label clears every other Layer. A group
 * label spans its `members` (`r` among them) and may sit over none else.
 */
function fitsLabel(
  r: Rect & { id: string },
  rects: ReadonlyArray<Rect & { id: string }>,
  zoom: number,
  screenHeight: number,
  members: ReadonlyArray<Rect & { id: string }> = [r]
): boolean {
  if (r.width * zoom < LAYER_LABEL_MIN_SCREEN_WIDTH - 1e-3) return false
  if (showsLayerDetail(zoom)) return true
  const stripHeight = screenHeight / zoom
  const strip = {
    x: r.x,
    y: r.y - stripHeight,
    width: widthAcross(r, members),
    height: stripHeight,
  }
  return !rects.some((o) => !members.includes(o) && overlaps(strip, o))
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}
