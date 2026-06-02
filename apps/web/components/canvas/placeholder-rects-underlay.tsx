"use client"

import { useEffect, useRef } from "react"

function resolveColor(
  el: HTMLElement,
  varName: string,
  fallback: string
): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const temp = document.createElement("div")
  temp.style.color = raw
  document.body.appendChild(temp)
  const resolved = getComputedStyle(temp).color
  document.body.removeChild(temp)
  return resolved
}

interface PlaceholderRectsUnderlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  /**
   * World-space rects for the trailing "+ frame" placeholder of every group
   * with a selected member. Rendered before the TransformWrapper in DOM order
   * so iframe contents and selection chrome paint on top — the placeholder is
   * a backdrop hint, not a foreground element.
   */
  rects: Array<{ x: number; y: number; width: number; height: number }>
}

/**
 * Screen-space underlay for the trailing "+ frame" placeholder outlines. Same
 * crisp 1px --border stroke as before; lives behind world content now so it
 * reads as a slot waiting to be filled rather than an overlay drawn on top.
 */
export function PlaceholderRectsUnderlay({
  zoom,
  viewportPos,
  rects,
}: PlaceholderRectsUnderlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const r = canvas.getBoundingClientRect()
    if (canvas.width !== r.width * dpr || canvas.height !== r.height * dpr) {
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    if (rects.length === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      return
    }

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })
    // Snap to device-pixel boundaries so 1px strokes stay crisp at any zoom
    // without jittering as the viewport pans sub-CSS-pixel amounts.
    const snap = (v: number) => Math.round(v * dpr) / dpr
    const HALF = 0.5 / dpr

    ctx.strokeStyle = resolveColor(canvas, "--border", "#a1a1aa")
    ctx.lineWidth = 1
    for (const rect of rects) {
      const tl = toScreen(rect.x, rect.y)
      const br = toScreen(rect.x + rect.width, rect.y + rect.height)
      const l = snap(tl.x)
      const t = snap(tl.y)
      const rr = snap(br.x)
      const b = snap(br.y)
      ctx.strokeRect(l + HALF, t + HALF, rr - l - 2 * HALF, b - t - 2 * HALF)
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, rects])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      const r = parent.getBoundingClientRect()
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
