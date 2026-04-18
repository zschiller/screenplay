"use client"

import { useEffect, useRef } from "react"
import type { ArtboardData } from "./artboard"

interface OtherSelection {
  selectedArtboardIds: string[]
  color: string
  name: string
}

interface SelectionOverlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  selectedArtboardIds: Set<string>
  focusedArtboardId: string | null
  hoveredArtboardId: string | null
  artboards: ArtboardData[]
  marquee: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  othersSelections: OtherSelection[]
  hideResizeHandles?: boolean
  inspectRect?: { x: number; y: number; width: number; height: number } | null
}

function resolveColor(el: HTMLElement, varName: string, fallback: string): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const temp = document.createElement("div")
  temp.style.color = raw
  document.body.appendChild(temp)
  const resolved = getComputedStyle(temp).color
  document.body.removeChild(temp)
  return resolved
}


export function SelectionOverlay({
  zoom,
  viewportPos,
  selectedArtboardIds,
  focusedArtboardId,
  hoveredArtboardId,
  artboards,
  marquee,
  othersSelections,
  hideResizeHandles,
  inspectRect,
}: SelectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    const primaryColor = "#d946ef" // tailwind fuchsia-500
    const bgColor = resolveColor(canvas, "--background", "#fff")
    const HANDLE_SIZE = 8

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    // Draw hover frame (only if not already selected/focused)
    if (hoveredArtboardId && !selectedArtboardIds.has(hoveredArtboardId) && focusedArtboardId !== hoveredArtboardId) {
      const ab = artboards.find((a) => a.id === hoveredArtboardId)
      if (ab) {
        const topLeft = toScreen(ab.x, ab.y)
        const sw = ab.width * zoom
        const sh = ab.height * zoom
        ctx.globalAlpha = 0.4
        ctx.strokeStyle = primaryColor
        ctx.lineWidth = 1
        ctx.strokeRect(
          Math.round(topLeft.x) - 0.5,
          Math.round(topLeft.y) - 0.5,
          Math.round(sw) + 1,
          Math.round(sh) + 1,
        )
        ctx.globalAlpha = 1
      }
    }

    // Draw other users' selections
    for (const other of othersSelections) {
      if (other.selectedArtboardIds.length === 0) continue
      ctx.strokeStyle = other.color
      ctx.lineWidth = 1
      for (const id of other.selectedArtboardIds) {
        const ab = artboards.find((a) => a.id === id)
        if (!ab) continue
        const tl = toScreen(ab.x, ab.y)
        const br = toScreen(ab.x + ab.width, ab.y + ab.height)
        const l = Math.round(tl.x)
        const t = Math.round(tl.y)
        const r = Math.round(br.x)
        const b = Math.round(br.y)
        ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
      }
    }

    // Compute rounded frame edges for selected/focused artboards
    const frameEdges = new Map<string, { l: number; t: number; r: number; b: number }>()
    for (const ab of artboards) {
      if (!selectedArtboardIds.has(ab.id) && focusedArtboardId !== ab.id) continue
      const tl = toScreen(ab.x, ab.y)
      const br = toScreen(ab.x + ab.width, ab.y + ab.height)
      frameEdges.set(ab.id, {
        l: Math.round(tl.x),
        t: Math.round(tl.y),
        r: Math.round(br.x),
        b: Math.round(br.y),
      })
    }

    // Draw selection frames
    ctx.strokeStyle = primaryColor
    ctx.lineWidth = 1
    for (const { l, t, r, b } of frameEdges.values()) {
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }

    // Draw resize handles for single selection
    if (selectedArtboardIds.size === 1 && !hideResizeHandles) {
      const id = selectedArtboardIds.values().next().value as string
      const edges = frameEdges.get(id)
      if (edges) {
        const { l, t, r, b } = edges
        const mx = Math.round((l + r) / 2)
        const my = Math.round((t + b) / 2)
        const hs = HANDLE_SIZE
        const hh = hs / 2

        const handles = [
          [l, t], [r, t], [l, b], [r, b],
          [mx, t], [mx, b], [l, my], [r, my],
        ]
        for (const [hx, hy] of handles) {
          ctx.fillStyle = bgColor
          ctx.fillRect(hx - hh, hy - hh, hs, hs)
          ctx.strokeStyle = primaryColor
          ctx.lineWidth = 1
          ctx.strokeRect(hx - hh + 0.5, hy - hh + 0.5, hs - 1, hs - 1)
        }
      }
    }

    // Draw union bounding rect when multiple artboards are selected
    if (selectedArtboardIds.size > 1) {
      let uLeft = Infinity, uTop = Infinity, uRight = -Infinity, uBottom = -Infinity
      for (const ab of artboards) {
        if (!selectedArtboardIds.has(ab.id)) continue
        uLeft = Math.min(uLeft, ab.x)
        uTop = Math.min(uTop, ab.y)
        uRight = Math.max(uRight, ab.x + ab.width)
        uBottom = Math.max(uBottom, ab.y + ab.height)
      }
      if (uLeft < Infinity) {
        const tl = toScreen(uLeft, uTop)
        const br = toScreen(uRight, uBottom)
        const l = Math.round(tl.x)
        const t = Math.round(tl.y)
        const r = Math.round(br.x)
        const b = Math.round(br.y)
        ctx.strokeStyle = primaryColor
        ctx.lineWidth = 1
        ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
      }
    }

    // Draw inspect rect (hovered or picked element)
    if (inspectRect) {
      const tl = toScreen(inspectRect.x, inspectRect.y)
      const br = toScreen(inspectRect.x + inspectRect.width, inspectRect.y + inspectRect.height)
      const l = Math.round(tl.x)
      const t = Math.round(tl.y)
      const r = Math.round(br.x)
      const b = Math.round(br.y)
      ctx.globalAlpha = 0.1
      ctx.fillStyle = "#3b82f6"
      ctx.fillRect(l, t, r - l, b - t)
      ctx.globalAlpha = 1
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 1
      // Inside stroke: inset by 0.5 so the 1px line sits entirely within the bounds
      ctx.strokeRect(l + 0.5, t + 0.5, r - l - 1, b - t - 1)
    }

    // Draw marquee rectangle
    if (marquee) {
      // Convert both corners to screen space, then round edges independently
      const a = toScreen(marquee.startX, marquee.startY)
      const b = toScreen(marquee.currentX, marquee.currentY)
      const l = Math.round(Math.min(a.x, b.x))
      const t = Math.round(Math.min(a.y, b.y))
      const r = Math.round(Math.max(a.x, b.x))
      const bo = Math.round(Math.max(a.y, b.y))

      ctx.globalAlpha = 0.1
      ctx.fillStyle = primaryColor
      ctx.fillRect(l, t, r - l, bo - t)

      ctx.globalAlpha = 1
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + 0.5, t + 0.5, r - l, bo - t)
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, selectedArtboardIds, focusedArtboardId, hoveredArtboardId, artboards, marquee, othersSelections, hideResizeHandles, inspectRect])

  // Keep canvas sized to container
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
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10"
    />
  )
}
