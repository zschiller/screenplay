"use client"

import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import { pixelGridLines, pixelGridOpacity } from "@/lib/canvas/pixel-grid"
import { CANVAS_COLOR, resolveCanvasColor } from "@/lib/canvas/tokens"

import type { LiveCamera } from "./live-zoom"
import { beginUnderlayDraw, useUnderlayCanvasSize } from "./underlay-canvas"

/**
 * The pixel grid (see `lib/canvas/pixel-grid.ts`): one device-pixel line at
 * every canvas pixel's edge, over the content, once zoomed past 400%. Drawn
 * on a screen-space canvas like the Layer edges and the Selection Overlay,
 * so its lines stay one sharp device pixel at any zoom, and it follows the
 * live camera frame by frame, so it never lags a pan or zoom. Below 400% it
 * releases its canvas.
 */
export function PixelGridOverlay({ camera }: { camera: LiveCamera }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { x, y, zoom } = camera.get()
    const opacity = pixelGridOpacity(zoom)
    const ctx = beginUnderlayDraw(canvas, opacity === 0)
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.width / dpr
    const height = canvas.height / dpr
    // Whole device pixels from here on.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = opacity
    ctx.fillStyle = resolveCanvasColor(canvas, CANVAS_COLOR.pixelGrid)
    for (const at of pixelGridLines(x, zoom, width, dpr)) {
      ctx.fillRect(at, 0, 1, canvas.height)
    }
    for (const at of pixelGridLines(y, zoom, height, dpr)) {
      ctx.fillRect(0, at, canvas.width, 1)
    }
    ctx.globalAlpha = 1
  }, [camera])

  useLayoutEffect(draw, [draw])
  useEffect(() => camera.subscribe(draw), [camera, draw])

  useUnderlayCanvasSize(canvasRef)
  // A resized view is redrawn whole, not stretched.
  useEffect(() => {
    const parent = canvasRef.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => requestAnimationFrame(draw))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [draw])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
