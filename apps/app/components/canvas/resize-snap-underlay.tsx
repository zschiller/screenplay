"use client"

import { useLayoutEffect, useRef } from "react"
import { type Icon, MonitorIcon } from "@workspace/ui/components/icons"
import type { AnchorCorner, SnapCandidate } from "@/lib/canvas/snap"
import {
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  type IframeLayerSizeCategory,
} from "@/lib/iframe-layer-sizes"
import { rectFromAnchor } from "@/lib/canvas/snap"
import { resolveCanvasColor } from "@/lib/canvas/tokens"

import { beginUnderlayDraw, useUnderlayCanvasSize } from "./underlay-canvas"

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

const CATEGORY_LABEL_ICON: Record<IframeLayerSizeCategory, Icon> =
  IFRAME_LAYER_SIZE_CATEGORY_ICONS

/**
 * Zoom-independent screen-space underlay shown while the user resizes an
 * iframeLayer from a corner. Renders before the TransformWrapper in DOM order so
 * the iframeLayer iframes paint on top — only the parts of each ghost that
 * extend past the active iframeLayer remain visible.
 *
 * Outlines: 1px crisp at any zoom (drawn on a screen-space canvas using the
 * same toScreen() trick as SelectionOverlay).
 * Snapped target: its rect is NOT drawn here (the live SelectionOverlay rect
 * already covers it and turns red); only its label is shown at the lower-right.
 * Non-snapped candidates fade in/out as silent gray ghosts.
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

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })

    // Non-snapped candidates draw as silent gray ghosts. The snapped target is
    // NOT drawn here — the live SelectionOverlay rect already sits exactly on it
    // (the iframeLayer is patched to the snapped size) and turns red itself, so
    // a ghost here would just double up on that rect.
    // Brightest (closest) candidate paints last so it sits on top. Each
    // ghost's screen rect, so the canvas covers only the ghosts: it redraws
    // on every resize step.
    const ghosts: {
      alpha: number
      l: number
      t: number
      r: number
      b: number
    }[] = []
    if (iframeLayerRect) {
      // Anchor in world space — the corner of the iframeLayer that's *not* moving.
      const ax =
        anchor === "tl" || anchor === "bl"
          ? iframeLayerRect.x
          : iframeLayerRect.x + iframeLayerRect.width
      const ay =
        anchor === "tl" || anchor === "tr"
          ? iframeLayerRect.y
          : iframeLayerRect.y + iframeLayerRect.height
      const sorted = [...candidates].sort((a, b) => b.distancePx - a.distancePx)
      for (const c of sorted) {
        // Skip the snapped target — the live red selection rect already marks it.
        if (snappedPresetId === c.preset.id) continue
        const { x, y } = rectFromAnchor(
          anchor,
          ax,
          ay,
          c.ghostWidth,
          c.ghostHeight
        )
        const tl = toScreen(x, y)
        const br = toScreen(x + c.ghostWidth, y + c.ghostHeight)
        ghosts.push({
          alpha: c.alpha,
          l: Math.round(tl.x),
          t: Math.round(tl.y),
          r: Math.round(br.x),
          b: Math.round(br.y),
        })
      }
    }
    // The outside strokes reach a pixel past each rect.
    const left = Math.min(...ghosts.map((g) => g.l)) - 1
    const top = Math.min(...ghosts.map((g) => g.t)) - 1
    const ctx = beginUnderlayDraw(canvas, ghosts.length === 0, {
      x: left,
      y: top,
      width: Math.max(...ghosts.map((g) => g.r)) + 1 - left,
      height: Math.max(...ghosts.map((g) => g.b)) + 1 - top,
    })
    if (!ctx) return

    const ghostColor = resolveCanvasColor(canvas, "--border")
    for (const { alpha, l, t, r, b } of ghosts) {
      ctx.globalAlpha = alpha
      ctx.strokeStyle = ghostColor
      ctx.lineWidth = 1
      // Match SelectionOverlay's outside-stroke convention so a snapped ghost
      // and the live selection rect line up pixel-for-pixel.
      ctx.strokeRect(l - 0.5, t - 0.5, r - l + 1, b - t + 1)
    }
    ctx.globalAlpha = 1

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [zoom, viewportPos, iframeLayerRect, anchor, candidates, snappedPresetId])

  useUnderlayCanvasSize(canvasRef)

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
          const Icon =
            CATEGORY_LABEL_ICON[snapped.preset.category] ?? MonitorIcon
          const orientationSuffix =
            snapped.orientation === "landscape" ? " · Landscape" : ""
          const dimensions = `${Math.round(snapped.ghostWidth)} × ${Math.round(snapped.ghostHeight)}`
          return (
            <div
              className="absolute flex items-center gap-1 text-xs leading-none font-semibold whitespace-nowrap text-canvas-snap"
              style={{
                left: snappedLabelPos.screenX,
                top: snappedLabelPos.screenY,
                transform: "translate(-100%, 4px)",
              }}
            >
              <Icon className="size-3" />
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
