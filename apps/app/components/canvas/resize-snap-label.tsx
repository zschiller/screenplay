"use client"

import { type Icon, MonitorIcon } from "@workspace/ui/components/icons"
import type { AnchorCorner, SnapCandidate } from "@/lib/canvas/snap"
import {
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  type IframeLayerSizeCategory,
} from "@/lib/iframe-layer-sizes"
import { rectFromAnchor } from "@/lib/canvas/snap"

interface ResizeSnapLabelProps {
  zoom: number
  viewportPos: { x: number; y: number }
  /** The iframeLayer's current world-space rect, as ResizeSnapUnderlay takes it. */
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
 * The device name under a frame's lower-right corner while a corner resize is
 * snapped to a device size. Screen-space, in the overlay above the frames, so
 * a neighbouring frame never paints over it (the ghosts stay in
 * ResizeSnapUnderlay, beneath the frames).
 */
export function ResizeSnapLabel({
  zoom,
  viewportPos,
  iframeLayerRect,
  anchor,
  candidates,
  snappedPresetId,
}: ResizeSnapLabelProps) {
  const snapped = snappedPresetId
    ? (candidates.find((c) => c.preset.id === snappedPresetId) ?? null)
    : null
  if (!snapped || !iframeLayerRect) return null

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
  const Icon = CATEGORY_LABEL_ICON[snapped.preset.category] ?? MonitorIcon
  const orientationSuffix =
    snapped.orientation === "landscape" ? " · Landscape" : ""
  const dimensions = `${Math.round(snapped.ghostWidth)} × ${Math.round(snapped.ghostHeight)}`

  return (
    <div className="pointer-events-none absolute inset-0 z-(--z-canvas-overlay)">
      <div
        className="absolute flex items-center gap-1 text-xs leading-none font-semibold whitespace-nowrap text-canvas-snap"
        style={{
          left: (x + snapped.ghostWidth) * zoom + viewportPos.x,
          top: (y + snapped.ghostHeight) * zoom + viewportPos.y,
          transform: "translate(-100%, 4px)",
        }}
      >
        <Icon className="size-3" />
        <span>
          {snapped.preset.label}
          {orientationSuffix} <span className="opacity-70">{dimensions}</span>
        </span>
      </div>
    </div>
  )
}
