/**
 * Edge/center snapping for frame *moves* (not resizes). Given the world-space
 * rect being dragged (the union bbox of all moving layers) and a list of
 * candidate rects to align against, returns:
 *
 *   - snapDx / snapDy: world-space offset to add to the raw position so the
 *     dragged rect locks to the nearest edge or center within threshold.
 *   - guides: red guide lines to draw. Each guide is axis-aligned, positioned
 *     at the world coord the snap targets, with `start`/`end` spanning the
 *     participating rects on the other axis so the line visually connects the
 *     dragged rect to its alignment partner.
 *
 * Distances are evaluated in screen pixels so threshold feel is independent of
 * zoom — at high zoom snap kicks in earlier (smaller world distances), at low
 * zoom it's more forgiving. Mirrors the convention in `iframe-layer-snap.ts`.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Axis "x" = vertical guide at constant world x. Axis "y" = horizontal guide
 * at constant world y. `marks` is the per-rect (start, end) extent on the
 * perpendicular axis for every rect that's aligned to this guide — used to
 * derive the line span (overall min/max) and to position the × end-markers.
 * `sourceKind` records which edge of the dragged rect drove the snap (min =
 * left/top, max = right/bottom, mid = center); the renderer uses it to pick
 * an outside-stroke offset that matches the selection-rect convention so the
 * guide visually lies on top of the aligned strokes instead of sitting one
 * device pixel inside.
 */
export interface SnapGuide {
  axis: "x" | "y"
  pos: number
  sourceKind: EdgeKind
  marks: ReadonlyArray<readonly [number, number]>
}

export interface MoveSnapResult {
  snapDx: number
  snapDy: number
  guides: SnapGuide[]
}

/** Snap engages within this many screen pixels of an edge/center match. */
export const MOVE_SNAP_THRESHOLD_PX = 6
/** Below this world delta we consider two positions exactly aligned for guide emission. */
const ALIGNMENT_EPSILON = 0.01

export type EdgeKind = "min" | "mid" | "max"

interface AxisEdge {
  pos: number
  kind: EdgeKind
  rect: Rect
}

function edgesX(r: Rect): AxisEdge[] {
  return [
    { pos: r.x, kind: "min", rect: r },
    { pos: r.x + r.width / 2, kind: "mid", rect: r },
    { pos: r.x + r.width, kind: "max", rect: r },
  ]
}

function edgesY(r: Rect): AxisEdge[] {
  return [
    { pos: r.y, kind: "min", rect: r },
    { pos: r.y + r.height / 2, kind: "mid", rect: r },
    { pos: r.y + r.height, kind: "max", rect: r },
  ]
}

interface BestSnap {
  delta: number
  targetPos: number
}

function findBestSnap(
  sourceEdges: AxisEdge[],
  candidateEdges: AxisEdge[],
  zoom: number,
  thresholdPx: number,
): BestSnap | null {
  let best: BestSnap | null = null
  let bestDistPx = Infinity
  for (const s of sourceEdges) {
    for (const c of candidateEdges) {
      const delta = c.pos - s.pos
      const distPx = Math.abs(delta) * zoom
      if (distPx > thresholdPx) continue
      if (distPx < bestDistPx) {
        bestDistPx = distPx
        best = { delta, targetPos: c.pos }
      }
    }
  }
  return best
}

/**
 * Collect every (source, candidate) edge pair that's exactly aligned after
 * the snap is applied — emits one guide per source edge that found at least
 * one match. The source edges fed in here are derived from the *snapped*
 * source rect, so `s.pos` already equals the candidate.pos it aligns with.
 *
 * `marks` is the perpendicular-axis (start, end) of every participating rect
 * (snapped source + each matched candidate). The renderer uses this both to
 * derive the line span (overall min/max) and to draw × end-markers at each
 * rect's corners on the alignment line.
 */
function collectGuides(
  sourceEdges: AxisEdge[],
  candidateEdges: AxisEdge[],
  axis: "x" | "y",
): SnapGuide[] {
  const guides: SnapGuide[] = []
  for (const s of sourceEdges) {
    const matching: AxisEdge[] = []
    for (const c of candidateEdges) {
      if (Math.abs(c.pos - s.pos) <= ALIGNMENT_EPSILON) matching.push(c)
    }
    if (matching.length === 0) continue
    const marks: Array<[number, number]> = []
    if (axis === "x") {
      marks.push([s.rect.y, s.rect.y + s.rect.height])
      for (const c of matching) marks.push([c.rect.y, c.rect.y + c.rect.height])
    } else {
      marks.push([s.rect.x, s.rect.x + s.rect.width])
      for (const c of matching) marks.push([c.rect.x, c.rect.x + c.rect.width])
    }
    guides.push({ axis, pos: s.pos, sourceKind: s.kind, marks })
  }
  return guides
}

export function computeMoveSnap(opts: {
  rect: Rect
  candidates: readonly Rect[]
  zoom: number
  thresholdPx?: number
}): MoveSnapResult {
  const { rect, candidates, zoom } = opts
  const threshold = opts.thresholdPx ?? MOVE_SNAP_THRESHOLD_PX

  if (candidates.length === 0) {
    return { snapDx: 0, snapDy: 0, guides: [] }
  }

  const sourceX = edgesX(rect)
  const sourceY = edgesY(rect)
  const candX: AxisEdge[] = []
  const candY: AxisEdge[] = []
  for (const c of candidates) {
    candX.push(...edgesX(c))
    candY.push(...edgesY(c))
  }

  const bestX = findBestSnap(sourceX, candX, zoom, threshold)
  const bestY = findBestSnap(sourceY, candY, zoom, threshold)

  const snapDx = bestX?.delta ?? 0
  const snapDy = bestY?.delta ?? 0

  // Re-derive source edges from the post-snap rect so `pos` equals the
  // candidate it aligns with (rather than tracking a parallel `snapDelta`
  // through the matcher). The mark extents on the perpendicular axis come
  // from the snapped rect too, so the × markers line up with the rect after
  // both-axis snap is applied.
  const snappedRect: Rect = {
    x: rect.x + snapDx,
    y: rect.y + snapDy,
    width: rect.width,
    height: rect.height,
  }
  const guides: SnapGuide[] = []
  if (bestX) guides.push(...collectGuides(edgesX(snappedRect), candX, "x"))
  if (bestY) guides.push(...collectGuides(edgesY(snappedRect), candY, "y"))

  return { snapDx, snapDy, guides }
}
