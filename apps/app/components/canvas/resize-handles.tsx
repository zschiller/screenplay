"use client"

import type { ResizeEdge } from "@/hooks/use-layer-resize"
import { resizeGrabZones } from "@/lib/canvas/resize-handles"

interface ResizeHandlesProps {
  /** The tile's world size; with `zoom` it gives the on-screen size. */
  width: number
  height: number
  zoom: number
  makeHandleProps: (edge: ResizeEdge) => {
    onPointerDown: (e: React.PointerEvent) => void
  }
}

/**
 * The 8 resize grab zones (4 edges + 4 corners) that wrap a singly-selected
 * canvas tile (iframeLayer or document). Sized in screen-pixel units so the
 * grab targets stay usable at any zoom, and live at every tile size even
 * when the drawn handles hide (`visibleResizeHandles`). On a small tile they
 * grow outward instead of inward (`resizeGrabZones`) so its middle stays
 * free to move it. Corners render last so they win over the adjacent edge
 * regions, which inset by the corners' inner reach. Parent must be
 * `position: relative`.
 */
export function ResizeHandles({
  width,
  height,
  zoom,
  makeHandleProps,
}: ResizeHandlesProps) {
  const { corner, edge } = resizeGrabZones(width * zoom, height * zoom)
  const px = (screen: number) => screen / zoom
  // Edges run between the corners' inner reach.
  const edgeX = { left: px(corner.x.inside), right: px(corner.x.inside) }
  const edgeY = { top: px(corner.y.inside), bottom: px(corner.y.inside) }
  const thickY = px(edge.y.inside + edge.y.outside)
  const thickX = px(edge.x.inside + edge.x.outside)
  const cornerW = px(corner.x.inside + corner.x.outside)
  const cornerH = px(corner.y.inside + corner.y.outside)
  const cx = -px(corner.x.outside)
  const cy = -px(corner.y.outside)

  return (
    <>
      <div
        className="absolute cursor-ns-resize touch-none"
        {...makeHandleProps("n")}
        style={{ top: -px(edge.y.outside), ...edgeX, height: thickY }}
      />
      <div
        className="absolute cursor-ns-resize touch-none"
        {...makeHandleProps("s")}
        style={{ bottom: -px(edge.y.outside), ...edgeX, height: thickY }}
      />
      <div
        className="absolute cursor-ew-resize touch-none"
        {...makeHandleProps("w")}
        style={{ left: -px(edge.x.outside), ...edgeY, width: thickX }}
      />
      <div
        className="absolute cursor-ew-resize touch-none"
        {...makeHandleProps("e")}
        style={{ right: -px(edge.x.outside), ...edgeY, width: thickX }}
      />
      <div
        className="absolute cursor-nwse-resize touch-none"
        {...makeHandleProps("nw")}
        style={{ top: cy, left: cx, width: cornerW, height: cornerH }}
      />
      <div
        className="absolute cursor-nesw-resize touch-none"
        {...makeHandleProps("ne")}
        style={{ top: cy, right: cx, width: cornerW, height: cornerH }}
      />
      <div
        className="absolute cursor-nesw-resize touch-none"
        {...makeHandleProps("sw")}
        style={{ bottom: cy, left: cx, width: cornerW, height: cornerH }}
      />
      <div
        className="absolute cursor-nwse-resize touch-none"
        {...makeHandleProps("se")}
        style={{ bottom: cy, right: cx, width: cornerW, height: cornerH }}
      />
    </>
  )
}
