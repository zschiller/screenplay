"use client"

import { useEffect, useRef, useState } from "react"
import type { TextLayerData } from "@/lib/liveblocks.types"
import type { ArtboardLayoutMap } from "@/lib/artboard-layout"

interface OtherSelection {
  selectedArtboardIds: string[]
  selectedTextLayerIds: string[]
  color: string
  name: string
}

interface SelectionOverlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  selectedArtboardIds: Set<string>
  /** Artboards highlighted because their parent group is selected. No resize handles. */
  groupSelectedArtboardIds: Set<string>
  selectedTextLayerIds: Set<string>
  focusedArtboardId: string | null
  hoveredArtboardId: string | null
  artboardLayouts: ArtboardLayoutMap
  /**
   * World-space rects for "add frame" placeholders. Drawn here (instead of in
   * the world transform) so the border stays 1px crisp at any zoom.
   */
  placeholderRects: Array<{ x: number; y: number; width: number; height: number }>
  textLayers: TextLayerData[]
  marquee: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  textDraft: {
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

function measureTextLayer(layer: TextLayerData): { w: number; h: number } {
  const el = typeof document !== "undefined" ? document.getElementById(`text-layer-${layer.id}`) : null
  const w = layer.autoWidth ? (el?.offsetWidth ?? layer.width) : layer.width
  const h = el?.offsetHeight ?? 24
  return { w, h }
}


export function SelectionOverlay({
  zoom,
  viewportPos,
  selectedArtboardIds,
  groupSelectedArtboardIds,
  selectedTextLayerIds,
  focusedArtboardId,
  hoveredArtboardId,
  artboardLayouts,
  placeholderRects,
  textLayers,
  marquee,
  textDraft,
  frameDraft,
  othersSelections,
  hideResizeHandles,
  inspectRect,
}: SelectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Text layers stored at width: max-content grow as the user types, but the
  // metadata in TextLayerData doesn't change — so without a separate signal
  // the overlay's frame stays glued to the pre-edit size. Watch every text
  // layer's DOM box and bump a counter on size changes to force a redraw.
  const [textLayerSizeTick, setTextLayerSizeTick] = useState(0)
  useEffect(() => {
    if (textLayers.length === 0) return
    const ro = new ResizeObserver(() => {
      setTextLayerSizeTick((n) => n + 1)
    })
    for (const layer of textLayers) {
      const el = document.getElementById(`text-layer-${layer.id}`)
      if (el) ro.observe(el)
    }
    return () => ro.disconnect()
  }, [textLayers])

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
    if (hoveredArtboardId && !selectedArtboardIds.has(hoveredArtboardId) && focusedArtboardId !== hoveredArtboardId) {
      const layout = artboardLayouts.get(hoveredArtboardId)
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
      if (other.selectedArtboardIds.length === 0 && other.selectedTextLayerIds.length === 0) continue
      ctx.strokeStyle = other.color
      ctx.lineWidth = 1
      for (const id of other.selectedArtboardIds) {
        const layout = artboardLayouts.get(id)
        if (!layout) continue
        const tl = toScreen(layout.x, layout.y)
        const br = toScreen(layout.x + layout.width, layout.y + layout.height)
        const l = Math.round(tl.x)
        const t = Math.round(tl.y)
        const r = Math.round(br.x)
        const b = Math.round(br.y)
        ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
      }
      for (const id of other.selectedTextLayerIds) {
        const layer = textLayers.find((l) => l.id === id)
        if (!layer) continue
        const { w: lw, h: lh } = measureTextLayer(layer)
        const tl = toScreen(layer.x, layer.y)
        const br = toScreen(layer.x + lw, layer.y + lh)
        const l = Math.round(tl.x)
        const t = Math.round(tl.y)
        const r = Math.round(br.x)
        const b = Math.round(br.y)
        ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
      }
    }

    // Compute rounded frame edges for selected/focused/group-selected artboards
    const frameEdges = new Map<string, { l: number; t: number; r: number; b: number }>()
    for (const layout of artboardLayouts.values()) {
      const inDirect = selectedArtboardIds.has(layout.id)
      const inGroup = groupSelectedArtboardIds.has(layout.id)
      if (!inDirect && !inGroup && focusedArtboardId !== layout.id) continue
      const tl = toScreen(layout.x, layout.y)
      const br = toScreen(layout.x + layout.width, layout.y + layout.height)
      frameEdges.set(layout.id, {
        l: Math.round(tl.x),
        t: Math.round(tl.y),
        r: Math.round(br.x),
        b: Math.round(br.y),
      })
    }

    // Compute edges for selected text layers
    const textFrameEdges = new Map<string, { l: number; t: number; r: number; b: number }>()
    for (const layer of textLayers) {
      if (!selectedTextLayerIds.has(layer.id)) continue
      const { w: lw, h: lh } = measureTextLayer(layer)
      const tl = toScreen(layer.x, layer.y)
      const br = toScreen(layer.x + lw, layer.y + lh)
      textFrameEdges.set(layer.id, {
        l: Math.round(tl.x),
        t: Math.round(tl.y),
        r: Math.round(br.x),
        b: Math.round(br.y),
      })
    }

    // Draw selection frames (artboards + text layers)
    ctx.strokeStyle = primaryColor
    ctx.lineWidth = 1
    for (const { l, t, r, b } of frameEdges.values()) {
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }
    for (const { l, t, r, b } of textFrameEdges.values()) {
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }

    // Draw resize handles for single artboard selection
    const totalSelected = selectedArtboardIds.size + selectedTextLayerIds.size
    if (selectedArtboardIds.size === 1 && totalSelected === 1 && !hideResizeHandles) {
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

    // Draw E/W resize handles for a single fixed-width text layer
    if (selectedTextLayerIds.size === 1 && totalSelected === 1 && !hideResizeHandles) {
      const id = selectedTextLayerIds.values().next().value as string
      const edges = textFrameEdges.get(id)
      const layer = textLayers.find((l) => l.id === id)
      if (edges && layer) {
        const { l, t, r, b } = edges
        const my = Math.round((t + b) / 2)
        const hs = HANDLE_SIZE
        const hh = hs / 2
        for (const [hx, hy] of [[l, my], [r, my]] as const) {
          ctx.fillStyle = bgColor
          ctx.fillRect(hx - hh, hy - hh, hs, hs)
          ctx.strokeStyle = primaryColor
          ctx.lineWidth = 1
          ctx.strokeRect(hx - hh + 0.5, hy - hh + 0.5, hs - 1, hs - 1)
        }
      }
    }

    // Draw union bounding rect when multiple items are selected
    if (totalSelected > 1) {
      let uLeft = Infinity, uTop = Infinity, uRight = -Infinity, uBottom = -Infinity
      for (const id of selectedArtboardIds) {
        const layout = artboardLayouts.get(id)
        if (!layout) continue
        uLeft = Math.min(uLeft, layout.x)
        uTop = Math.min(uTop, layout.y)
        uRight = Math.max(uRight, layout.x + layout.width)
        uBottom = Math.max(uBottom, layout.y + layout.height)
      }
      for (const layer of textLayers) {
        if (!selectedTextLayerIds.has(layer.id)) continue
        const { w: lw, h: lh } = measureTextLayer(layer)
        uLeft = Math.min(uLeft, layer.x)
        uTop = Math.min(uTop, layer.y)
        uRight = Math.max(uRight, layer.x + lw)
        uBottom = Math.max(uBottom, layer.y + lh)
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

    // Draw text-draft rectangle (while dragging with the text tool)
    if (textDraft) {
      const a = toScreen(textDraft.startX, textDraft.startY)
      const b = toScreen(textDraft.currentX, textDraft.currentY)
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

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, selectedArtboardIds, groupSelectedArtboardIds, selectedTextLayerIds, focusedArtboardId, hoveredArtboardId, artboardLayouts, placeholderRects, textLayers, marquee, textDraft, frameDraft, othersSelections, hideResizeHandles, inspectRect, textLayerSizeTick])

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
