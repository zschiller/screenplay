import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import { resolveBranchColorIndex } from "@/lib/branch-colors"

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

/**
 * A stored Frame Capture: the public URL of one Iframe Layer's screenshot plus
 * the moment it was taken. `capturedAt` (ms epoch) both lets the grid cache-bust
 * a single frame's blob without re-fetching its untouched siblings and tells a
 * retained capture (carried over from a prior round) apart from a fresh one.
 */
export type FrameCapture = {
  url: string
  capturedAt: number
}

/**
 * One Iframe Layer's placement in the composed thumbnail, with its capture when
 * one exists. `capture` is `null` for a frame whose preview hasn't been captured
 * yet (booting, skipped, or never captured) — the compositor renders those as
 * branch-tinted, labeled placeholder rectangles rather than dropping them.
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
  /**
   * Resolved index into `BRANCH_COLORS`, snapshotted from the Y.Doc at build
   * time. `null` for a frame bound to no Branch. The compositor re-resolves it
   * through `getBranchColorByIndex` so a placeholder's tint stays theme-aware.
   */
  paletteIndex: number | null
  capture: FrameCapture | null
}

/**
 * The per-layer input `buildThumbnailManifest` needs: identity, label, and the
 * bound Branch's palette inputs (its id is the hash key; `branchColorIndex` is
 * the manual override). Kept separate from `IframeLayerData` because the palette
 * override lives on `BranchData`, not the layer.
 */
export type ManifestLayer = {
  id: string
  label: string
  /** The bound Branch's id (the palette hash key), or `null` for a frame with no Branch. */
  branchKey: string | null
  /** The Branch's manual palette override, if any. */
  branchColorIndex?: number
}

export type ManifestBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type ThumbnailManifest = {
  /**
   * Schema version, so the compositor can evolve the shape without a migration.
   * v2 added each frame's snapshotted Branch `paletteIndex`; legacy v1 rows lack
   * it and the compositor treats the missing index as a neutral placeholder.
   */
  version: 2
  /**
   * Monotonic per-Room write counter, bumped on *every* rebuild — a capture
   * round and a layout-only rebuild alike. The home grid's poll-merge
   * (`room-thumbnail-merge.ts`) keys freshness off this rather than
   * `thumbnailUpdatedAt`: a layout-only write deliberately leaves the capture
   * clock untouched (so it doesn't trip the capture cooldown), so without a
   * revision the grid would discard a moved/resized/renamed frame until the next
   * capture or a full reload. Optional for legacy rows written before this field
   * existed — the merge treats a missing revision as the oldest.
   */
  revision?: number
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
 * Build a Thumbnail Manifest from the *current* Canvas Layout snapshot, this
 * round's fresh Frame Captures, and (optionally) the room's previous manifest —
 * giving each frame a stable identity keyed by Iframe Layer id across capture
 * rounds (#470):
 *
 * - **Reposition / rename / recolor.** Every placed frame takes its rect, label,
 *   and resolved Branch palette index from the *current* layout, so a moved,
 *   resized, renamed, or recolored frame is reflected on its next rebuild —
 *   independent of whether a new image was captured.
 * - **Merge.** A frame whose id is in `captures` adopts that fresh capture
 *   (overwriting only its own image + timestamp); siblings are untouched.
 * - **Retain last-good.** A frame with no fresh capture this round (booting,
 *   skipped, or a failed/timed-out capture) keeps the capture it carried in
 *   `previous`, rather than reverting to a placeholder. It lands captureless —
 *   a branch-tinted placeholder — only when neither source has an image.
 * - **Prune.** Frames that were in `previous` but are absent from the current
 *   layout simply aren't iterated, so they drop out of the rebuilt manifest.
 *
 * The palette index is *resolved here*, at build time, against the Branch info
 * snapshotted off the Y.Doc — so the manifest is decoupled from the live doc and
 * the compositor only re-resolves the index to theme-aware classes. Layers with
 * no layout (not in any group) are skipped — there's nowhere to place them.
 *
 * Pure and order-preserving: frames come out in `iframeLayers` order.
 */
export function buildThumbnailManifest(
  layouts: IframeLayerLayoutMap,
  iframeLayers: readonly ManifestLayer[],
  captures: ReadonlyMap<string, FrameCapture>,
  previous: ThumbnailManifest | null = null
): ThumbnailManifest {
  const retained = new Map<string, FrameCapture>()
  for (const frame of previous?.frames ?? []) {
    if (frame.capture) retained.set(frame.id, frame.capture)
  }

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
      paletteIndex:
        layer.branchKey === null
          ? null
          : resolveBranchColorIndex(layer.branchKey, layer.branchColorIndex),
      capture: captures.get(layer.id) ?? retained.get(layer.id) ?? null,
    })
  }
  return {
    version: 2,
    // Bump the prior manifest's revision so every rebuild — capture or
    // layout-only — advances a signal the home grid's poll-merge can see, even
    // when the layout lane leaves the capture clock (`thumbnailUpdatedAt`)
    // untouched. Missing on legacy rows → treated as 0, so the first new write
    // lands at revision 1.
    revision: (previous?.revision ?? 0) + 1,
    bounds: computeBounds(frames),
    frames,
  }
}
