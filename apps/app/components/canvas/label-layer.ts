"use client"

import { createContext } from "react"
import type { LiveCamera } from "./live-zoom"

/**
 * The screen-space layer Layer labels are drawn in, above the zoomed content.
 *
 * Labels are UI, not content: they keep one size at every zoom. Inside the
 * zoomed content they had to counter-scale by `1/zoom`, and WebKit guessed
 * badly at what resolution to rasterize that doubly scaled text — soft, then
 * pixellated, depending on how it was composited. Here they're drawn at UI
 * scale and only moved: each label portals into `element` and positions itself
 * from `camera` on every transform frame, snapped to whole device pixels (see
 * `layer-title-bar.tsx`). Like the selection overlay, but DOM, because labels
 * hold text, buttons, menus and rename fields.
 *
 * `element` lives inside rzpp's wrapper (beside the transformed content), so a
 * wheel or pan that starts on a label still reaches the camera, and the
 * canvas's pointer routing still sees it as on the canvas.
 */
export interface LabelLayer {
  element: HTMLElement
  camera: LiveCamera
}

export const LabelLayerContext = createContext<LabelLayer | null>(null)

/** Marks a label's root with its Layer's id. Labels no longer sit inside
 *  their Layer's `[data-layer-id]` container, so pointer routing that asks
 *  "which Layer was pressed" checks this too. */
export const LAYER_LABEL_ATTRIBUTE = "data-layer-label"

/** The Layer id a press landed on: its body or its label. */
export function pressedLayerId(target: Element): string | null {
  const body = target.closest<HTMLElement>("[data-layer-id]")
  if (body) return body.dataset.layerId ?? null
  return (
    target
      .closest<HTMLElement>(`[${LAYER_LABEL_ATTRIBUTE}]`)
      ?.getAttribute(LAYER_LABEL_ATTRIBUTE) ?? null
  )
}

/** Snap a screen coordinate to the device pixel grid, so label text lands on
 *  whole pixels however the camera sits. */
export function snapToDevicePixel(px: number, dpr: number): number {
  return Math.round(px * dpr) / dpr
}
