"use client"

import { useCallback } from "react"

import { getGroupMembers } from "@/lib/canvas/layout"
import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
} from "@/lib/types"
import { openExternal } from "@/lib/open-external"
import type { CanvasCamera } from "./use-canvas-camera"

export interface FrameActions {
  /** Zoom-to-fit a single Iframe Layer by id (sidebar / agent-add follow). */
  selectIframeLayer: (iframeLayerId: string) => void
  /** Zoom-to-fit a Markdown Layer (document) by id. */
  zoomToDocument: (markdownLayerId: string) => void
  /** Zoom-to-fit a whole Group's bounding box. */
  zoomToGroup: (groupId: string) => void
  /** Add a fresh Iframe Layer for a running agent, then zoom to it. */
  addIframeLayerForAgent: (agentId: string) => void
  /** Open one frame per discovered route for an agent, then zoom to the first. */
  showRoutesForAgent: (agentId: string) => void
  /** Open the standalone /play view for a Branch. */
  playAgent: (branchId: string) => void
  /** Open the standalone /play view focused on one Iframe Layer (route + knobs). */
  playIframeLayer: (iframeLayerId: string) => void
}

/**
 * The frame-action handlers — zoom-to, play, and add-frame-for-agent — the
 * sidebar and member layer call. Pure orchestration over the Canvas Camera
 * (zoom-to-fit), the frame-creation Canvas Operations (`addIframeLayer`,
 * `addRoutesGroupForAgent`), and the standalone /play route. Grouped here
 * because they are "things you do to a frame from a list," distinct from the
 * canvas gesture/draw surface.
 */
export function useFrameActions({
  camera,
  agents,
  iframeLayers,
  iframeLayerGroups,
  effectiveIframeLayerLayouts,
  addIframeLayer,
  addRoutesGroupForAgent,
  roomId,
}: {
  camera: CanvasCamera
  agents: BranchData[]
  iframeLayers: IframeLayerData[]
  iframeLayerGroups: IframeLayerGroupData[]
  effectiveIframeLayerLayouts: IframeLayerLayoutMap
  addIframeLayer: (agentId: string, label: string) => string | undefined
  addRoutesGroupForAgent: (
    agentId: string,
    routes: { route: string; label: string }[]
  ) => { groupId: string; firstIframeLayerId: string } | undefined
  roomId: string
}): FrameActions {
  // Zoom-to actions delegate the fit math to the Canvas Camera controller
  // (`zoomToElement` / `zoomToRect`, over the pure `lib/canvas/camera`).
  const selectIframeLayer = useCallback(
    (iframeLayerId: string) => {
      const el = document.getElementById(`iframe-layer-${iframeLayerId}`)
      if (el) camera.zoomToElement(el)
    },
    [camera]
  )

  const zoomToDocument = useCallback(
    (markdownLayerId: string) => {
      const el = document.getElementById(`markdown-layer-${markdownLayerId}`)
      if (el) camera.zoomToElement(el)
    },
    [camera]
  )

  const zoomToGroup = useCallback(
    (groupId: string) => {
      const group = iframeLayerGroups.find((g) => g.id === groupId)
      if (!group) return
      const members = getGroupMembers(group)
      if (members.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const m of members) {
        const layout = effectiveIframeLayerLayouts.get(m.id)
        if (!layout) continue
        if (layout.x < minX) minX = layout.x
        if (layout.y < minY) minY = layout.y
        if (layout.x + layout.width > maxX) maxX = layout.x + layout.width
        if (layout.y + layout.height > maxY) maxY = layout.y + layout.height
      }
      if (!isFinite(minX) || !isFinite(minY)) return
      camera.zoomToRect({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      })
    },
    [camera, iframeLayerGroups, effectiveIframeLayerLayouts]
  )

  const addIframeLayerForAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.status !== "running") return
      const existing = iframeLayers.filter((a) => a.branchId === agentId)
      const newId = addIframeLayer(agentId, `Frame ${existing.length + 1}`)
      if (newId) {
        // Wait for DOM to render the new iframeLayer, then zoom to it
        requestAnimationFrame(() => {
          selectIframeLayer(newId)
        })
      }
    },
    [agents, iframeLayers, addIframeLayer, selectIframeLayer]
  )

  const showRoutesForAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return
      const routes = agent.discoveredRoutes ?? []
      if (routes.length === 0) {
        alert("No routes have been discovered for this branch yet.")
        return
      }
      const result = addRoutesGroupForAgent(agentId, routes)
      if (result) {
        requestAnimationFrame(() => {
          selectIframeLayer(result.firstIframeLayerId)
        })
      }
    },
    [agents, addRoutesGroupForAgent, selectIframeLayer]
  )

  const playAgent = useCallback(
    (branchId: string) => {
      openExternal(`/play/${roomId}/${branchId}`)
    },
    [roomId]
  )

  const playIframeLayer = useCallback(
    (iframeLayerId: string) => {
      const iframeLayer = iframeLayers.find((a) => a.id === iframeLayerId)
      if (!iframeLayer?.branchId) return
      const params = new URLSearchParams()
      params.set("iframe-layer", iframeLayerId)
      if (iframeLayer.route) params.set("route", iframeLayer.route)
      if (
        iframeLayer.knobValues &&
        Object.keys(iframeLayer.knobValues).length > 0
      ) {
        try {
          const json = JSON.stringify(iframeLayer.knobValues)
          const b64 =
            typeof btoa === "function"
              ? btoa(json)
              : Buffer.from(json, "utf-8").toString("base64")
          params.set("k", encodeURIComponent(b64))
        } catch {}
      }
      const url = `/play/${roomId}/${iframeLayer.branchId}?${params.toString()}`
      openExternal(url)
    },
    [iframeLayers, roomId]
  )

  return {
    selectIframeLayer,
    zoomToDocument,
    zoomToGroup,
    addIframeLayerForAgent,
    showRoutesForAgent,
    playAgent,
    playIframeLayer,
  }
}
