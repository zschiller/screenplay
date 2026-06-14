import "server-only"

import {
  computeIframeLayerLayouts,
  type IframeLayerLayoutMap,
} from "@/lib/canvas/layout"
import { readRoomDoc } from "@/lib/yjs/server"

/**
 * One layer as the capture path sees it: its label (for the manifest), the live
 * preview URL to screenshot, and its bound Branch's palette inputs (`branchKey`
 * is the hash key; `branchColorIndex` the manual override).
 * `previewUrl` is `null` when the layer's Branch has no ready preview yet (no
 * `previewDomain`), so the capture loop skips it and the manifest records a
 * branch-tinted, captureless placeholder. `branchKey` is `null` for a frame
 * bound to no Branch.
 *
 * Markdown (document) layers ride this same path: they have no preview to
 * screenshot, so they land with `previewUrl` and `branchKey` both `null` — a
 * neutral, captureless placeholder labeled by the document's title — and still
 * occupy their place in the composed thumbnail.
 */
export type CaptureFrame = {
  id: string
  label: string
  previewUrl: string | null
  branchKey: string | null
  branchColorIndex?: number
}

/**
 * The Room's layout as captured at thumbnail time: the world-space rects from
 * the canonical `computeIframeLayerLayouts` derivation, plus the per-frame
 * labels and preview URLs. Reads the room's Y.Doc once — the only Y.Doc read on
 * the capture path — and returns plain data so the rest of the path stays
 * Yjs-free.
 */
export type RoomCaptureLayout = {
  layouts: IframeLayerLayoutMap
  frames: CaptureFrame[]
}

export async function readRoomCaptureLayout(
  roomId: string
): Promise<RoomCaptureLayout> {
  return readRoomDoc(roomId, (c) => {
    const branches = c.branches.toMap()
    const iframeLayers = c.iframeLayers.toArray()
    const markdownLayers = c.markdownLayers.toArray()
    const groups = c.iframeLayerGroups.toArray()
    const layouts = computeIframeLayerLayouts(groups, iframeLayers, markdownLayers)
    const iframeFrames: CaptureFrame[] = iframeLayers.map((a) => {
      const branch = a.branchId ? branches.get(a.branchId) : undefined
      const previewDomain = branch?.previewDomain
      return {
        id: a.id,
        label: a.label,
        previewUrl: previewDomain ? previewDomain + (a.route ?? "") : null,
        // Snapshot the bound Branch's palette inputs so the manifest can resolve
        // a placeholder tint without re-reading the doc at grid time.
        branchKey: a.branchId ?? null,
        branchColorIndex: branch?.colorIndex,
      }
    })
    // Markdown (document) layers have nothing to screenshot, so they ride the
    // path as captureless, Branch-less placeholders labeled by their title —
    // they hold their place in the composed thumbnail alongside iframe layers.
    const markdownFrames: CaptureFrame[] = markdownLayers.map((m) => ({
      id: m.id,
      label: m.title,
      previewUrl: null,
      branchKey: null,
    }))
    return { layouts, frames: [...iframeFrames, ...markdownFrames] }
  })
}
