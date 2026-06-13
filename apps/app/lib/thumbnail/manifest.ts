import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import type { IframeLayerData } from "@/lib/types"

/**
 * The Thumbnail Manifest — the per-Room snapshot a thumbnail is *composed from
 * at display time*, in place of a single baked image. Each Iframe Layer's
 * placement (rect + label) is paired with its most recent Frame Capture (absent
 * until the preview has been captured ready); the homescreen grid reads this as
 * a cheap per-Room record and assembles the composite itself.
 *
 * This module is deliberately pure — no React, no Yjs, no `server-only` — so it
 * is exercised with plain fixtures and imported by the client grid. The capture
 * orchestration (`./capture`) feeds it a layout snapshot + a captures map; it
 * owns none of the screenshot, storage, or persistence machinery.
 */

/** A stored Frame Capture: the public URL of one Iframe Layer's screenshot. */
export type FrameCapture = {
  url: string
}

/**
 * One Iframe Layer's placement in the composed thumbnail, with its capture when
 * one exists. `capture` is `null` for a frame whose preview hasn't been captured
 * yet — the compositor renders those as positioned blanks rather than dropping
 * them.
 */
export type ManifestFrame = {
  /** Iframe Layer id. */
  id: string
  label: string
  /** World-space rect (canvas coordinates), straight from the layout derivation. */
  x: number
  y: number
  width: number
  height: number
  capture: FrameCapture | null
}

export type ManifestBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type ThumbnailManifest = {
  /** Schema version, so the compositor can evolve the shape without a migration. */
  version: 1
  /** Union of all frame rects in world space — the compositor maps this onto the card. */
  bounds: ManifestBounds
  frames: ManifestFrame[]
}

/** Union of every frame's rect, or a zero rect when there are no frames. */
function computeBounds(frames: readonly ManifestFrame[]): ManifestBounds {
  if (frames.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const f of frames) {
    minX = Math.min(minX, f.x)
    minY = Math.min(minY, f.y)
    maxX = Math.max(maxX, f.x + f.width)
    maxY = Math.max(maxY, f.y + f.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Build a Thumbnail Manifest from a Canvas Layout snapshot plus a map of Frame
 * Captures keyed by Iframe Layer id. Each Iframe Layer that has a computed
 * layout is placed (rect + label); a frame whose id is in `captures` carries its
 * capture reference, the rest carry `null`. Layers with no layout (not in any
 * group) are skipped — there's nowhere to place them.
 *
 * Pure and order-preserving: frames come out in `iframeLayers` order.
 */
export function buildThumbnailManifest(
  layouts: IframeLayerLayoutMap,
  iframeLayers: readonly Pick<IframeLayerData, "id" | "label">[],
  captures: ReadonlyMap<string, FrameCapture>
): ThumbnailManifest {
  const frames: ManifestFrame[] = []
  for (const layer of iframeLayers) {
    const layout = layouts.get(layer.id)
    if (!layout) continue
    frames.push({
      id: layer.id,
      label: layer.label,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      capture: captures.get(layer.id) ?? null,
    })
  }
  return { version: 1, bounds: computeBounds(frames), frames }
}
