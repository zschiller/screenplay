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
 * group is being dragged near another group's trailing "+ frame" slot. Uses
 * the same gray --border outline as a normal "add frame" placeholder.
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

    if (!rects || rects.length === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      return
    }

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    ctx.strokeStyle = resolveColor(canvas, "--border", "#a1a1aa")
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
