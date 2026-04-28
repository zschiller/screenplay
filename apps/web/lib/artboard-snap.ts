import {
  ARTBOARD_SIZE_PRESETS,
  type ArtboardSizePreset,
} from "@/lib/artboard-sizes"

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export type SnapOrientation = "portrait" | "landscape"

export type SnapCandidate = {
  preset: ArtboardSizePreset
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
 * For a given edge being dragged and the current (raw, un-snapped) artboard
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
  presets?: readonly ArtboardSizePreset[]
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

  const presets = opts.presets ?? ARTBOARD_SIZE_PRESETS
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
 * The corner of the artboard that should stay anchored during a resize from
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
