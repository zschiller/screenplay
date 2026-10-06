"use client"

import { useEffect, useRef } from "react"

import { CANVAS_COLOR, resolveCanvasColor } from "@/lib/canvas/tokens"

import { beginUnderlayDraw, useUnderlayCanvasSize } from "./underlay-canvas"

interface GroupMergeUnderlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  /**
   * World-space rects for the group-merge snap preview — one per source-group
   * member, positioned where each would land after merging into the target's
   * trailing-edge slot. Drawn in screen-space so the 1px outline stays crisp
   * at any zoom.
   */
  rects: Array<{ x: number; y: number; width: number; height: number }> | null
}

/**
 * Screen-space underlay that renders the group-merge drop target while a
 * group is being dragged near another group's trailing "+ frame" slot. Drawn
 * as a low-opacity outline in the group-merge token to signal the drop target.
 * Rendered before the TransformWrapper in DOM order so the source group (and
 * any other world content) paints on top — only the empty target slot remains
 * visible behind the preview outlines, mirroring [[ResizeSnapUnderlay]].
 */
export function GroupMergeUnderlay({
  zoom,
  viewportPos,
  rects,
}: GroupMergeUnderlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = beginUnderlayDraw(canvas, !rects || rects.length === 0)
    if (!ctx || !rects) return

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    ctx.strokeStyle = resolveCanvasColor(canvas, CANVAS_COLOR.groupMerge)
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    for (const rect of rects) {
      const tl = toScreen(rect.x, rect.y)
      const br = toScreen(rect.x + rect.width, rect.y + rect.height)
      const l = Math.round(tl.x)
      const t = Math.round(tl.y)
      const rr = Math.round(br.x)
      const b = Math.round(br.y)
      ctx.strokeRect(l + 0.5, t + 0.5, rr - l - 1, b - t - 1)
    }
    ctx.globalAlpha = 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, rects])

  useUnderlayCanvasSize(canvasRef)

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
