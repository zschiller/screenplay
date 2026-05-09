"use client"

import { useEffect, useRef } from "react"
import type { IframeLayerLayoutMap } from "@/lib/iframe-layer-layout"

interface OtherSelection {
  selectedIframeLayerIds: string[]
  color: string
  name: string
}

interface SelectionOverlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  selectedIframeLayerIds: Set<string>
  /** IframeLayers highlighted because their parent group is selected. No resize handles. */
  groupSelectedIframeLayerIds: Set<string>
  focusedIframeLayerId: string | null
  hoveredIframeLayerId: string | null
  iframeLayerLayouts: IframeLayerLayoutMap
  /**
   * World-space rects for "add frame" placeholders. Drawn here (instead of in
   * the world transform) so the border stays 1px crisp at any zoom.
   */
  placeholderRects: Array<{ x: number; y: number; width: number; height: number }>
  marquee: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  frameDraft: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  documentDraft: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  othersSelections: OtherSelection[]
  hideResizeHandles?: boolean
  inspectRect?: { x: number; y: number; width: number; height: number } | null
  /**
   * One handle per inter-iframeLayer gap in selected groups. World-space
   * `centerX` is the gap's midpoint; `top`/`bottom` clamp the handle to the
   * shared height of the two adjacent iframeLayers. Drawn at constant screen-pixel
   * size so the grab target doesn't change with zoom.
   */
  gapHandles?: Array<{
    groupId: string
    gapIndex: number
    centerX: number
    top: number
    bottom: number
  }>
  /**
   * One reorder handle per iframeLayer in a selected multi-iframeLayer group. The
   * world-space center is projected to screen and drawn as a small dot at
   * constant pixel size. Pressing one starts a drag that reorders the
   * iframeLayers in the group.
   */
  reorderHandles?: Array<{ iframeLayerId: string; centerX: number; centerY: number }>
  /** When the cursor is over a reorder dot, render that one filled instead of hollow. */
  hoveredReorderIframeLayerId?: string | null
  /**
   * World-space shift applied to the lifted iframeLayer's frame outline and its
   * reorder dot during a reorder drag — keeps the overlay aligned with the
   * translated iframeLayer DOM element.
   */
  reorderDragShift?: { iframeLayerId: string; dx: number; dy: number } | null
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
  selectedIframeLayerIds,
  groupSelectedIframeLayerIds,
  focusedIframeLayerId,
  hoveredIframeLayerId,
  iframeLayerLayouts,
  placeholderRects,
  marquee,
  frameDraft,
  documentDraft,
  othersSelections,
  hideResizeHandles,
  inspectRect,
  gapHandles,
  reorderHandles,
  hoveredReorderIframeLayerId,
  reorderDragShift,
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
    const borderColor = resolveColor(canvas, "--border", "#a1a1aa")
    const HANDLE_SIZE = 8

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    // Draw hover frame (only if not already selected/focused)
    if (hoveredIframeLayerId && !selectedIframeLayerIds.has(hoveredIframeLayerId) && focusedIframeLayerId !== hoveredIframeLayerId) {
      const layout = iframeLayerLayouts.get(hoveredIframeLayerId)
      if (layout) {
        const topLeft = toScreen(layout.x, layout.y)
        const sw = layout.width * zoom
        const sh = layout.height * zoom
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
      if (other.selectedIframeLayerIds.length === 0) continue
      ctx.strokeStyle = other.color
      ctx.lineWidth = 1
      for (const id of other.selectedIframeLayerIds) {
        const layout = iframeLayerLayouts.get(id)
        if (!layout) continue
        const tl = toScreen(layout.x, layout.y)
        const br = toScreen(layout.x + layout.width, layout.y + layout.height)
        const l = Math.round(tl.x)
        const t = Math.round(tl.y)
        const r = Math.round(br.x)
        const b = Math.round(br.y)
        ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
      }
    }

    // Compute rounded frame edges for selected/focused/group-selected iframeLayers
    const frameEdges = new Map<string, { l: number; t: number; r: number; b: number }>()
    for (const layout of iframeLayerLayouts.values()) {
      const inDirect = selectedIframeLayerIds.has(layout.id)
      const inGroup = groupSelectedIframeLayerIds.has(layout.id)
      if (!inDirect && !inGroup && focusedIframeLayerId !== layout.id) continue
      // Lifted iframeLayer's outline tracks its translated DOM position.
      const shift = reorderDragShift && reorderDragShift.iframeLayerId === layout.id ? reorderDragShift : null
      const ox = shift ? shift.dx : 0
      const oy = shift ? shift.dy : 0
      const tl = toScreen(layout.x + ox, layout.y + oy)
      const br = toScreen(layout.x + layout.width + ox, layout.y + layout.height + oy)
      frameEdges.set(layout.id, {
        l: Math.round(tl.x),
        t: Math.round(tl.y),
        r: Math.round(br.x),
        b: Math.round(br.y),
      })
    }

    // Draw selection frames for iframeLayers
    ctx.strokeStyle = primaryColor
    ctx.lineWidth = 1
    for (const { l, t, r, b } of frameEdges.values()) {
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }

    // Draw resize handles for single iframeLayer selection
    const totalSelected = selectedIframeLayerIds.size
    if (selectedIframeLayerIds.size === 1 && totalSelected === 1 && !hideResizeHandles) {
      const id = selectedIframeLayerIds.values().next().value as string
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

    // Draw union bounding rect when multiple iframeLayers are selected
    if (totalSelected > 1) {
      let uLeft = Infinity, uTop = Infinity, uRight = -Infinity, uBottom = -Infinity
      for (const id of selectedIframeLayerIds) {
        const layout = iframeLayerLayouts.get(id)
        if (!layout) continue
        uLeft = Math.min(uLeft, layout.x)
        uTop = Math.min(uTop, layout.y)
        uRight = Math.max(uRight, layout.x + layout.width)
        uBottom = Math.max(uBottom, layout.y + layout.height)
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

    // Draw "add frame" placeholders — solid 1px border, no fill, square corners.
    if (placeholderRects.length > 0) {
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 1
      for (const rect of placeholderRects) {
        const tl = toScreen(rect.x, rect.y)
        const br = toScreen(rect.x + rect.width, rect.y + rect.height)
        const l = Math.round(tl.x)
        const t = Math.round(tl.y)
        const r = Math.round(br.x)
        const b = Math.round(br.y)
        ctx.strokeRect(l + 0.5, t + 0.5, r - l - 1, b - t - 1)
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

    // Draw reorder handles — matches symaphore's CompositionHandle. Both
    // states are 12×12 outer (1px white) with a 1px primary ring at 10×10.
    // The 8×8 center is hollow by default (group:hover state — transparent
    // center with 1px white inset) and filled when the cursor is over the
    // dot (handle:hover inherits 8×8 from group:hover, only swapping the bg
    // back to primary).
    if (reorderHandles && reorderHandles.length > 0) {
      for (const h of reorderHandles) {
        const shift = reorderDragShift && reorderDragShift.iframeLayerId === h.iframeLayerId ? reorderDragShift : null
        const ox = shift ? shift.dx : 0
        const oy = shift ? shift.dy : 0
        const center = toScreen(h.centerX + ox, h.centerY + oy)
        const cx = Math.round(center.x) + 0.5
        const cy = Math.round(center.y) + 0.5
        const filled = h.iframeLayerId === hoveredReorderIframeLayerId
        // 12×12 outer white
        ctx.beginPath()
        ctx.arc(cx, cy, 6, 0, Math.PI * 2)
        ctx.fillStyle = bgColor
        ctx.fill()
        // 10×10 primary (1px ring outside the 8×8)
        ctx.beginPath()
        ctx.arc(cx, cy, 5, 0, Math.PI * 2)
        ctx.fillStyle = primaryColor
        ctx.fill()
        if (filled) {
          // Hovered: leave the 8×8 center filled primary — no further draw needed.
        } else {
          // Default: 1px white inset around an 8×8 transparent center.
          ctx.beginPath()
          ctx.arc(cx, cy, 4, 0, Math.PI * 2)
          ctx.fillStyle = bgColor
          ctx.fill()
          ctx.save()
          ctx.beginPath()
          ctx.arc(cx, cy, 3, 0, Math.PI * 2)
          ctx.globalCompositeOperation = "destination-out"
          ctx.fill()
          ctx.restore()
        }
      }
    }

    // Draw gap-resize handles for selected groups. Matches symaphore's
    // GapHandle: a 1×12 primary-color line with a 1px bg-color outline.
    // Constant screen-pixel size since it lives on the screen-space overlay.
    if (gapHandles && gapHandles.length > 0) {
      const HH = 12
      for (const h of gapHandles) {
        const center = toScreen(h.centerX, (h.top + h.bottom) / 2)
        const cx = Math.round(center.x)
        const cy = Math.round(center.y)
        const halfH = Math.min(HH / 2, ((h.bottom - h.top) * zoom) / 2)
        // 3×(HH+2) white outline rect, then 1×HH primary line on top.
        ctx.fillStyle = bgColor
        ctx.fillRect(cx - 1, cy - halfH - 1, 3, halfH * 2 + 2)
        ctx.fillStyle = primaryColor
        ctx.fillRect(cx, cy - halfH, 1, halfH * 2)
      }
    }

    // Draw frame-draft rectangle (while dragging with the frame tool)
    if (frameDraft) {
      const a = toScreen(frameDraft.startX, frameDraft.startY)
      const b = toScreen(frameDraft.currentX, frameDraft.currentY)
      const l = Math.round(Math.min(a.x, b.x))
      const t = Math.round(Math.min(a.y, b.y))
      const r = Math.round(Math.max(a.x, b.x))
      const bo = Math.round(Math.max(a.y, b.y))

      ctx.globalAlpha = 1
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + 0.5, t + 0.5, r - l, bo - t)
      ctx.setLineDash([])
    }

    // Draw document-draft rectangle (while dragging with the document tool)
    if (documentDraft) {
      const a = toScreen(documentDraft.startX, documentDraft.startY)
      const b = toScreen(documentDraft.currentX, documentDraft.currentY)
      const l = Math.round(Math.min(a.x, b.x))
      const t = Math.round(Math.min(a.y, b.y))
      const r = Math.round(Math.max(a.x, b.x))
      const bo = Math.round(Math.max(a.y, b.y))

      ctx.globalAlpha = 1
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + 0.5, t + 0.5, r - l, bo - t)
      ctx.setLineDash([])
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, selectedIframeLayerIds, groupSelectedIframeLayerIds, focusedIframeLayerId, hoveredIframeLayerId, iframeLayerLayouts, placeholderRects, marquee, frameDraft, documentDraft, othersSelections, hideResizeHandles, inspectRect, gapHandles, reorderHandles, hoveredReorderIframeLayerId, reorderDragShift])

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
