import "server-only"

import {
  computeIframeLayerLayouts,
  type IframeLayerLayoutMap,
} from "@/lib/canvas/layout"
import type { RoomReader } from "@/lib/room-access"

/**
 * One layer as the capture path sees it: its label (for the manifest) and the
 * live preview URL to screenshot. `previewUrl` is `null` when the layer has no
 * bound Branch or its Branch has no ready preview yet (no `previewDomain`), so
 * the capture loop skips it and the manifest records a neutral, captureless
 * placeholder.
 *
 * Markdown (document) layers ride this same path: they have no preview to
 * screenshot, so they land with a `null` `previewUrl` — a captureless
 * placeholder labeled by the document's title — and still occupy their place in
 * the composed thumbnail.
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
  room: RoomReader
): Promise<RoomCaptureLayout> {
  return room.readDoc((c) => {
    const branches = c.branches.toMap()
    const iframeLayers = c.iframeLayers.toArray()
    const markdownLayers = c.markdownLayers.toArray()
    const mockupLayers = c.mockupLayers.toArray()
    const groups = c.iframeLayerGroups.toArray()
    const layouts = computeIframeLayerLayouts(groups, iframeLayers, [
      ...markdownLayers,
      ...mockupLayers,
    ])
    const iframeFrames: CaptureFrame[] = iframeLayers.map((a) => {
      const branch = a.branchId ? branches.get(a.branchId) : undefined
      const previewDomain = branch?.previewDomain
      return {
        id: a.id,
        label: a.label,
        previewUrl: previewDomain ? previewDomain + (a.route ?? "") : null,
      }
    })
    // Document and mockup layers have no preview URL to screenshot, so they
    // ride the path as captureless placeholders labeled by their title —
    // they hold their place in the composed thumbnail alongside iframe layers.
    const titledFrames: CaptureFrame[] = [
      ...markdownLayers,
      ...mockupLayers,
    ].map((m) => ({
      id: m.id,
      label: m.title,
      previewUrl: null,
    }))
    return { layouts, frames: [...iframeFrames, ...titledFrames] }
  })
}
