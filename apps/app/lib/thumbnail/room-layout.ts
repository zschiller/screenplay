import "server-only"

import {
  computeIframeLayerLayouts,
  type IframeLayerLayoutMap,
} from "@/lib/canvas/layout"
import { readRoomDoc } from "@/lib/yjs/server"

/**
 * One Iframe Layer as the capture path sees it: its label (for the manifest) and
 * the live preview URL to screenshot. `previewUrl` is `null` when the layer's
 * Branch has no ready preview yet (no `previewDomain`), so the capture loop
 * skips it and the manifest records a captureless frame.
 */
export type CaptureFrame = {
  id: string
  label: string
  previewUrl: string | null
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
    const frames: CaptureFrame[] = iframeLayers.map((a) => {
      const branch = a.branchId ? branches.get(a.branchId) : undefined
      const previewDomain = branch?.previewDomain
      return {
        id: a.id,
        label: a.label,
        previewUrl: previewDomain ? previewDomain + (a.route ?? "") : null,
      }
    })
    return { layouts, frames }
  })
}
