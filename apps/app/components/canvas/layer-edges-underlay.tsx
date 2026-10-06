"use client"

import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import { CANVAS_COLOR, resolveCanvasColor } from "@/lib/canvas/tokens"

import type { LiveCamera } from "./live-zoom"
import { beginUnderlayDraw, useUnderlayCanvasSize } from "./underlay-canvas"

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface LayerEdgesUnderlayProps {
  /** Every Layer's world-space box (frames, Mockups, Documents). */
  layouts: ReadonlyMap<string, Rect>
  /** The in-flow reorder drag's offset for the dragged Layer, as the
   *  Selection Overlay gets it. */
  dragShift: { iframeLayerId: string; dx: number; dy: number } | null
  camera: LiveCamera
}

/**
 * Each Layer's resting hairline: a square 1px line just outside its box, drawn
 * in device pixels on a screen-space canvas beneath the zoomed content, the way
 * the Selection Overlay draws selection above it. A Layer in front covers the
 * edges behind it, and the selection ring lands on the same pixels.
 *
 * It follows the live camera frame by frame (like the labels), not the
 * deferred zoom the overlays read, so it never lags or hides mid-pan or
 * mid-zoom.
 */
export function LayerEdgesUnderlay({
  layouts,
  dragShift,
  camera,
}: LayerEdgesUnderlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // What `draw` reads, kept current on every render so a camera frame (which
  // renders nothing) draws the latest geometry.
  const props = useRef({ layouts, dragShift })
  useLayoutEffect(() => {
    props.current = { layouts, dragShift }
  })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { layouts, dragShift } = props.current
    const { x, y, zoom } = camera.get()
    const dpr = window.devicePixelRatio || 1
    // Snap to device pixels so the line stays one crisp device-pixel-aligned
    // CSS pixel at any zoom.
    const snap = (v: number) => Math.round(v * dpr) / dpr

    const boxes: Array<{ l: number; t: number; r: number; b: number }> = []
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const [id, rect] of layouts) {
      const shift = dragShift?.iframeLayerId === id ? dragShift : null
      const wx = rect.x + (shift?.dx ?? 0)
      const wy = rect.y + (shift?.dy ?? 0)
      const l = snap(x + wx * zoom)
      const t = snap(y + wy * zoom)
      const r = snap(x + (wx + rect.width) * zoom)
      const b = snap(y + (wy + rect.height) * zoom)
      boxes.push({ l, t, r, b })
      minX = Math.min(minX, l - 1)
      minY = Math.min(minY, t - 1)
      maxX = Math.max(maxX, r + 1)
      maxY = Math.max(maxY, b + 1)
    }

    const ctx = beginUnderlayDraw(
      canvas,
      boxes.length === 0,
      boxes.length === 0
        ? undefined
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    )
    if (!ctx) return
    ctx.strokeStyle = resolveCanvasColor(canvas, CANVAS_COLOR.layerEdge)
    ctx.lineWidth = 1
    // Centred half a pixel outside the box, so the line covers the whole
    // pixel row and column just outside it, where the selection ring draws.
    for (const { l, t, r, b } of boxes) {
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [camera])

  useLayoutEffect(draw, [draw, layouts, dragShift])
  useEffect(() => camera.subscribe(draw), [camera, draw])

  useUnderlayCanvasSize(canvasRef)

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
