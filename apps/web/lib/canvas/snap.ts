/**
 * Canvas snapping — the three pure snap kinds that fire during canvas
 * interactions, co-located next to `ops.ts` and the Canvas Layout module:
 *
 *   - **move-snap** (`computeMoveSnap`): a dragged rect aligns to its peers'
 *     edges/centers within a threshold, returning a world-space offset plus
 *     the Snap Guides drawn during the drag.
 *   - **resize-snap** (`computeDeviceSnap`): an Iframe Layer's size clamps to
 *     the nearest standard device size within a threshold.
 *   - **merge-snap** (`computeMergeSnap`): a dragged Group goes "hot" against
 *     the nearest other Group whose trailing "+ frame" slot is within a
 *     threshold, returning the hot target plus the rects to highlight for the
 *     merged-row preview.
 *
 * All three are React-free and Yjs-free, with the threshold as a parameter.
 */

import {
  IFRAME_LAYER_SIZE_PRESETS,
  type IframeLayerSizePreset,
} from "@/lib/iframe-layer-sizes"

// ---------------------------------------------------------------------------
// Move-snap
//
// Edge/center snapping for frame *moves* (not resizes). Given the world-space
// rect being dragged (the union bbox of all moving layers) and a list of
// candidate rects to align against, returns:
//
//   - snapDx / snapDy: world-space offset to add to the raw position so the
//     dragged rect locks to the nearest edge or center within threshold.
//   - guides: red guide lines to draw. Each guide is axis-aligned, positioned
//     at the world coord the snap targets, with `start`/`end` spanning the
//     participating rects on the other axis so the line visually connects the
//     dragged rect to its alignment partner.
//
// Distances are evaluated in screen pixels so threshold feel is independent of
// zoom — at high zoom snap kicks in earlier (smaller world distances), at low
// zoom it's more forgiving. Same convention as resize-snap below.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Resize-snap
//
// Device-size snapping for Iframe Layer *resizes*: an Iframe Layer's size
// clamps to the nearest standard device size within a threshold.
// ---------------------------------------------------------------------------

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export type SnapOrientation = "portrait" | "landscape"

export type SnapCandidate = {
  preset: IframeLayerSizePreset
  orientation: SnapOrientation
  /** Effective ghost dimensions: preset on snap-affected axes, raw on others. */
  ghostWidth: number
  ghostHeight: number
  /** Screen-pixel distance between raw size and this candidate. */
  distancePx: number
  /** 0..1 fade-in opacity (1 at exact match, 0 at fade radius). */
  alpha: number
  /** Dimensions the snap would lock to. `undefined` means leave as-is. */
  snapWidth?: number
  snapHeight?: number
}

export type SnapResult = {
  candidates: SnapCandidate[]
  /** Final size after applying the best snap (or raw if none matched). */
  width: number
  height: number
  snappedPresetId: string | null
  snappedOrientation: SnapOrientation | null
}

/** Snap when within this many screen pixels of a preset. */
export const SNAP_THRESHOLD_PX = 8
/** Fade in starts here. Linear from 0 alpha at this distance to 1 at zero. */
export const FADE_RADIUS_PX = 80

function isHoriz(edge: ResizeEdge): boolean {
  return edge !== "n" && edge !== "s"
}
function isVert(edge: ResizeEdge): boolean {
  return edge !== "e" && edge !== "w"
}

/**
 * For a given edge being dragged and the current (raw, un-snapped) iframeLayer
 * size, find every device preset within fade radius and compute the snapped
 * size. Only fires for *corner* drags (both axes moving) — single-edge drags
 * don't trigger device snaps. Mobile and Tablet presets are matched in both
 * portrait and landscape orientations; Desktop only in their stored
 * orientation.
 *
 * Distances are measured in *screen pixels* so the feel scales with zoom: at
 * high zoom snapping kicks in earlier (in world units), at low zoom it's more
 * forgiving.
 */
export function computeDeviceSnap(opts: {
  edge: ResizeEdge
  rawWidth: number
  rawHeight: number
  zoom: number
  presets?: readonly IframeLayerSizePreset[]
}): SnapResult {
  // Only corner drags get the device-size snap underlay — single-edge drags
  // are reserved for free-form resizing without snap interference.
  if (!isHoriz(opts.edge) || !isVert(opts.edge)) {
    return {
      candidates: [],
      width: opts.rawWidth,
      height: opts.rawHeight,
      snappedPresetId: null,
      snappedOrientation: null,
    }
  }

  const presets = opts.presets ?? IFRAME_LAYER_SIZE_PRESETS
  const horiz = true
  const vert = true
  const { rawWidth, rawHeight, zoom } = opts

  const candidates: SnapCandidate[] = []
  // Dedupe presets that share dimensions (e.g. iPhone 17 / 17 Pro / Air all
  // 402×874): the first one in the list wins. Avoids rendering identical
  // ghost rects on top of each other.
  const seen = new Set<string>()

  for (const preset of presets) {
    const orientations: Array<{ w: number; h: number; name: SnapOrientation }> = [
      { w: preset.width, h: preset.height, name: "portrait" },
    ]
    if (preset.category === "Mobile" || preset.category === "Tablet") {
      orientations.push({
        w: preset.height,
        h: preset.width,
        name: "landscape",
      })
    }

    for (const o of orientations) {
      const key = `${o.w}x${o.h}`
      if (seen.has(key)) continue

      const dW = horiz ? o.w - rawWidth : 0
      const dH = vert ? o.h - rawHeight : 0

      let distancePx: number
      if (horiz && vert) {
        distancePx = Math.hypot(dW, dH) * zoom
      } else if (horiz) {
        distancePx = Math.abs(dW) * zoom
      } else {
        distancePx = Math.abs(dH) * zoom
      }

      if (distancePx > FADE_RADIUS_PX) continue

      seen.add(key)
      const alpha = Math.max(0, 1 - distancePx / FADE_RADIUS_PX)
      candidates.push({
        preset,
        orientation: o.name,
        ghostWidth: horiz ? o.w : rawWidth,
        ghostHeight: vert ? o.h : rawHeight,
        distancePx,
        alpha,
        snapWidth: horiz ? o.w : undefined,
        snapHeight: vert ? o.h : undefined,
      })
    }
  }

  // Pick the closest candidate within the snap threshold.
  let best: SnapCandidate | null = null
  for (const c of candidates) {
    if (c.distancePx > SNAP_THRESHOLD_PX) continue
    if (!best || c.distancePx < best.distancePx) best = c
  }

  if (best) {
    return {
      candidates,
      width: best.snapWidth ?? rawWidth,
      height: best.snapHeight ?? rawHeight,
      snappedPresetId: best.preset.id,
      snappedOrientation: best.orientation,
    }
  }
  return {
    candidates,
    width: rawWidth,
    height: rawHeight,
    snappedPresetId: null,
    snappedOrientation: null,
  }
}

/**
 * The corner of the iframeLayer that should stay anchored during a resize from
 * `edge` — used to position the snap ghost rects so they grow/shrink toward
 * the dragged edge instead of jumping around the screen.
 */
export type AnchorCorner = "tl" | "tr" | "bl" | "br"

export function anchorCornerForEdge(edge: ResizeEdge): AnchorCorner {
  switch (edge) {
    // Right/bottom move, top/left stays.
    case "e":
    case "s":
    case "se":
      return "tl"
    // Top/right move, bottom/left stays.
    case "n":
    case "ne":
      return "bl"
    // Left/bottom move, top/right stays.
    case "w":
    case "sw":
      return "tr"
    // Top/left move, bottom/right stays.
    case "nw":
      return "br"
  }
}

/** Translate an anchor corner + size into the rect's top-left in world space. */
export function rectFromAnchor(
  anchor: AnchorCorner,
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (anchor) {
    case "tl":
      return { x: anchorX, y: anchorY }
    case "tr":
      return { x: anchorX - width, y: anchorY }
    case "bl":
      return { x: anchorX, y: anchorY - height }
    case "br":
      return { x: anchorX - width, y: anchorY - height }
  }
}

// ---------------------------------------------------------------------------
// Merge-snap
//
// Group merge detection during a single-group drag: the dragged Group goes
// "hot" against the nearest other Group whose trailing "+ frame" placeholder
// slot lands within a fixed world-space radius of the dragged Group's leading
// (top-left) corner. Each candidate carries its own content rect and gap; the
// trailing slot sits at `rect.x + rect.width + gap`, top-aligned with the
// candidate (`rect.y`). On a hit we lay out one highlight rect per source
// member starting at that slot, flexed left-to-right with the target's gap, so
// the preview matches the post-merge layout.
//
// Distances are world-space (not screen pixels) so the snap zone stays
// proportional to the content at any zoom — the same convention the inline
// implementation used before it moved here.
// ---------------------------------------------------------------------------

/** A Group the dragged Group could merge into. */
export interface MergeSnapCandidate {
  /** Identifier echoed back as the hot target. */
  id: string
  /** The candidate Group's content rect in world space. */
  rect: Rect
  /** The candidate's inter-member gap — positions the trailing slot and spaces the preview. */
  gap: number
}

export interface MergeSnapResult {
  /** The Group the dragged Group would merge into. */
  targetId: string
  /** One highlight rect per source member, laid out in the merged target row. */
  rects: Rect[]
}

/** A Group goes hot within this many *world* units of a target's trailing slot. */
export const MERGE_SNAP_THRESHOLD = 150

/**
 * Pick the nearest merge target for a dragged Group, or `null` when none is
 * within threshold (or the dragged Group has no extent / no laid-out members).
 *
 * `rect` is the dragged Group's content rect; only its top-left corner drives
 * detection, while its width/height guard against degenerate (zero-size)
 * groups. `memberSizes` are the dragged Group's member box sizes in member
 * order — used to build the highlight preview at the chosen slot.
 */
export function computeMergeSnap(opts: {
  rect: Rect
  memberSizes: readonly { width: number; height: number }[]
  candidates: readonly MergeSnapCandidate[]
  threshold?: number
}): MergeSnapResult | null {
  const { rect, memberSizes, candidates } = opts
  const threshold = opts.threshold ?? MERGE_SNAP_THRESHOLD

  // Degenerate source (no resolvable members) can't merge into anything.
  if (rect.width === 0 || rect.height === 0) return null

  let best:
    | { id: string; dist: number; x: number; y: number; gap: number }
    | null = null
  for (const c of candidates) {
    const placeholderX = c.rect.x + c.rect.width + c.gap
    const placeholderY = c.rect.y
    const dx = rect.x - placeholderX
    const dy = rect.y - placeholderY
    const dist = Math.hypot(dx, dy)
    if (dist < threshold && (!best || dist < best.dist)) {
      best = { id: c.id, dist, x: placeholderX, y: placeholderY, gap: c.gap }
    }
  }
  if (!best) return null

  // One rect per source member, laid out at the positions they'd occupy in the
  // merged target row. The target's gap is used between them so the preview
  // matches the actual post-merge layout.
  const rects: Rect[] = []
  let cursorX = best.x
  for (const size of memberSizes) {
    rects.push({ x: cursorX, y: best.y, width: size.width, height: size.height })
    cursorX += size.width + best.gap
  }
  if (rects.length === 0) return null

  return { targetId: best.id, rects }
}
