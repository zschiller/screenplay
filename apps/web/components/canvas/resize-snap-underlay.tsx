"use client"

import { useEffect, useRef } from "react"
import { Monitor, type LucideIcon } from "lucide-react"
import type { AnchorCorner, SnapCandidate } from "@/lib/canvas/snap"
import {
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  type IframeLayerSizeCategory,
} from "@/lib/iframe-layer-sizes"
import { rectFromAnchor } from "@/lib/canvas/snap"

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

interface ResizeSnapUnderlayProps {
  zoom: number
  viewportPos: { x: number; y: number }
  /**
   * The iframeLayer's current world-space rect (post-snap on the current frame),
   * used to derive the anchor corner that ghosts pivot around.
   */
  iframeLayerRect: {
    x: number
    y: number
    width: number
    height: number
  } | null
  anchor: AnchorCorner
  candidates: SnapCandidate[]
  snappedPresetId: string | null
}

const CATEGORY_LABEL_ICON: Record<IframeLayerSizeCategory, LucideIcon> =
  IFRAME_LAYER_SIZE_CATEGORY_ICONS

/**
 * Zoom-independent screen-space underlay shown while the user resizes an
 * iframeLayer from a corner. Renders before the TransformWrapper in DOM order so
 * the iframeLayer iframes paint on top — only the parts of each ghost that
 * extend past the active iframeLayer remain visible.
 *
 * Outlines: 1px crisp at any zoom (drawn on a screen-space canvas using the
 * same toScreen() trick as SelectionOverlay).
 * Snapped target: only the locked-in candidate gets a fuchsia label at its
 * lower-right; non-snapped candidates fade in/out as silent ghosts.
 */
export function ResizeSnapUnderlay({
  zoom,
  viewportPos,
  iframeLayerRect,
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

    if (!iframeLayerRect || candidates.length === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      return
    }

    // Snapped: fuchsia matching SelectionOverlay primary.
    // Non-snapped: --border (same gray as the placeholder rect).
    const ghostColor = resolveColor(canvas, "--border", "#a1a1aa")
    const snappedColor = "#d946ef"

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    // Anchor in world space — the corner of the iframeLayer that's *not* moving.
    const ax =
      anchor === "tl" || anchor === "bl"
        ? iframeLayerRect.x
        : iframeLayerRect.x + iframeLayerRect.width
    const ay =
      anchor === "tl" || anchor === "tr"
        ? iframeLayerRect.y
        : iframeLayerRect.y + iframeLayerRect.height

    // Brightest (closest) candidate paints last so it sits on top.
    const sorted = [...candidates].sort((a, b) => b.distancePx - a.distancePx)

    for (const c of sorted) {
      const { x, y } = rectFromAnchor(
        anchor,
        ax,
        ay,
        c.ghostWidth,
        c.ghostHeight
      )
      const tl = toScreen(x, y)
      const br = toScreen(x + c.ghostWidth, y + c.ghostHeight)
      const l = Math.round(tl.x)
      const t = Math.round(tl.y)
      const r = Math.round(br.x)
      const b = Math.round(br.y)
      const isSnapped = snappedPresetId === c.preset.id
      ctx.globalAlpha = c.alpha
      ctx.strokeStyle = isSnapped ? snappedColor : ghostColor
      ctx.lineWidth = 1
      // Match SelectionOverlay's outside-stroke convention so a snapped ghost
      // and the live selection rect line up pixel-for-pixel.
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }
    ctx.globalAlpha = 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, iframeLayerRect, anchor, candidates, snappedPresetId])

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

  // Snapped-only label — non-snapped candidates show as silent outlines.
  const snapped = snappedPresetId
    ? (candidates.find((c) => c.preset.id === snappedPresetId) ?? null)
    : null
  let snappedLabelPos: { screenX: number; screenY: number } | null = null
  if (snapped && iframeLayerRect) {
    const ax =
      anchor === "tl" || anchor === "bl"
        ? iframeLayerRect.x
        : iframeLayerRect.x + iframeLayerRect.width
    const ay =
      anchor === "tl" || anchor === "tr"
        ? iframeLayerRect.y
        : iframeLayerRect.y + iframeLayerRect.height
    const { x, y } = rectFromAnchor(
      anchor,
      ax,
      ay,
      snapped.ghostWidth,
      snapped.ghostHeight
    )
    snappedLabelPos = {
      screenX: (x + snapped.ghostWidth) * zoom + viewportPos.x,
      screenY: (y + snapped.ghostHeight) * zoom + viewportPos.y,
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {snapped &&
        snappedLabelPos &&
        (() => {
          const Icon = CATEGORY_LABEL_ICON[snapped.preset.category] ?? Monitor
          const orientationSuffix =
            snapped.orientation === "landscape" ? " · Landscape" : ""
          const dimensions = `${Math.round(snapped.ghostWidth)} × ${Math.round(snapped.ghostHeight)}`
          return (
            <div
              className="absolute flex items-center gap-1 text-[11px] leading-none font-semibold whitespace-nowrap"
              style={{
                left: snappedLabelPos.screenX,
                top: snappedLabelPos.screenY,
                transform: "translate(-100%, 4px)",
                color: "#d946ef",
              }}
            >
              <Icon className="h-3 w-3" />
              <span>
                {snapped.preset.label}
                {orientationSuffix}{" "}
                <span className="opacity-70">{dimensions}</span>
              </span>
            </div>
          )
        })()}
    </div>
  )
}
