"use client"

import { useEffect, useRef } from "react"
import { Monitor, type LucideIcon } from "lucide-react"
import type { AnchorCorner, SnapCandidate } from "@/lib/artboard-snap"
import {
  ARTBOARD_SIZE_CATEGORY_ICONS,
  type ArtboardSizeCategory,
} from "@/lib/artboard-sizes"
import { rectFromAnchor } from "@/lib/artboard-snap"

interface ResizeSnapUnderlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  /**
   * The artboard's current world-space rect (post-snap on the current frame),
   * used to derive the anchor corner that ghosts pivot around.
   */
  artboardRect: { x: number; y: number; width: number; height: number } | null
  anchor: AnchorCorner
  candidates: SnapCandidate[]
  snappedPresetId: string | null
}

const CATEGORY_LABEL_ICON: Record<ArtboardSizeCategory, LucideIcon> = ARTBOARD_SIZE_CATEGORY_ICONS

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

/**
 * Zoom-independent underlay that fades in nearby device-size frames while the
 * user is resizing an artboard. Uses the same screen-space canvas approach as
 * SelectionOverlay so the 1px outlines stay crisp at any zoom. Sits below the
 * SelectionOverlay (z-5) so the active selection frame paints over it.
 */
export function ResizeSnapUnderlay({
  zoom,
  viewportPos,
  artboardRect,
  anchor,
  candidates,
  snappedPresetId,
}: ResizeSnapUnderlayProps) {
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

    if (!artboardRect || candidates.length === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      return
    }

    // Same gray as the "add frame" placeholder rect — keeps the visual
    // language consistent: gray means "potential frame", fuchsia means
    // "selected frame".
    const borderColor = resolveColor(canvas, "--border", "#a1a1aa")

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    // Anchor in world space — the corner of the artboard that's *not* moving.
    const ax =
      anchor === "tl" || anchor === "bl"
        ? artboardRect.x
        : artboardRect.x + artboardRect.width
    const ay =
      anchor === "tl" || anchor === "tr"
        ? artboardRect.y
        : artboardRect.y + artboardRect.height

    // Brightest (closest) candidate paints last so it sits on top.
    const sorted = [...candidates].sort((a, b) => b.distancePx - a.distancePx)

    for (const c of sorted) {
      const { x, y } = rectFromAnchor(anchor, ax, ay, c.ghostWidth, c.ghostHeight)
      const tl = toScreen(x, y)
      const br = toScreen(x + c.ghostWidth, y + c.ghostHeight)
      const l = Math.round(tl.x)
      const t = Math.round(tl.y)
      const r = Math.round(br.x)
      const b = Math.round(br.y)
      ctx.globalAlpha = c.alpha
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + 0.5, t + 0.5, r - l - 1, b - t - 1)
    }
    ctx.globalAlpha = 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, artboardRect, anchor, candidates])

  // Keep canvas sized to its container.
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

  // The corner the user is dragging from is the opposite of the anchored
  // corner. The label sits just outside the ghost at that dragged corner, so
  // it appears to track the cursor.
  const draggedCorner: AnchorCorner =
    anchor === "tl" ? "br"
    : anchor === "tr" ? "bl"
    : anchor === "bl" ? "tr"
    : "tl"

  // Place the label outside the ghost so the outline remains visible behind it.
  const labelOffsetPx = 4
  const labelTransform = (() => {
    switch (draggedCorner) {
      case "br": return `translate(-100%, ${labelOffsetPx}px)`
      case "bl": return `translate(0, ${labelOffsetPx}px)`
      case "tr": return `translate(-100%, calc(-100% - ${labelOffsetPx}px))`
      case "tl": return `translate(0, calc(-100% - ${labelOffsetPx}px))`
    }
  })()

  // Label anchor position in *world space* per ghost — the dragged corner of
  // each candidate's rect.
  const labels: Array<{
    key: string
    candidate: SnapCandidate
    screenX: number
    screenY: number
  }> = []
  if (artboardRect) {
    const ax =
      anchor === "tl" || anchor === "bl"
        ? artboardRect.x
        : artboardRect.x + artboardRect.width
    const ay =
      anchor === "tl" || anchor === "tr"
        ? artboardRect.y
        : artboardRect.y + artboardRect.height
    for (const c of candidates) {
      const { x, y } = rectFromAnchor(anchor, ax, ay, c.ghostWidth, c.ghostHeight)
      const cornerX =
        draggedCorner === "tr" || draggedCorner === "br" ? x + c.ghostWidth : x
      const cornerY =
        draggedCorner === "bl" || draggedCorner === "br" ? y + c.ghostHeight : y
      labels.push({
        key: `${c.preset.id}-${c.orientation}`,
        candidate: c,
        screenX: cornerX * zoom + viewportPos.x,
        screenY: cornerY * zoom + viewportPos.y,
      })
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {labels.map(({ key, candidate, screenX, screenY }) => {
        const Icon = CATEGORY_LABEL_ICON[candidate.preset.category] ?? Monitor
        const isSnapped =
          snappedPresetId === candidate.preset.id && candidate.alpha > 0.99
        const orientationSuffix =
          candidate.orientation === "landscape" ? " · Landscape" : ""
        const dimensions = `${Math.round(candidate.ghostWidth)} × ${Math.round(candidate.ghostHeight)}`
        return (
          <div
            key={key}
            className="absolute flex items-center gap-1 whitespace-nowrap text-[11px] leading-none"
            style={{
              left: screenX,
              top: screenY,
              transform: labelTransform,
              opacity: candidate.alpha,
              color: "var(--border)",
              fontWeight: isSnapped ? 600 : 400,
            }}
          >
            <Icon className="h-3 w-3" />
            <span>
              {candidate.preset.label}
              {orientationSuffix}
              {" "}
              <span className="opacity-70">{dimensions}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
