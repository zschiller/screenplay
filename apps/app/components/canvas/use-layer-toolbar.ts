"use client"

import type { RefObject } from "react"
import { useCanvasAnchoredPortal } from "@/hooks/use-canvas-anchored-portal"

// A selected layer's floating toolbar hangs centred under it, like Safari's
// bottom bar (issue #795). Screen px: its gap below the layer, the canvas
// toolbar strip it stays above when the layer runs off screen, and its inset
// from the canvas's side edges.
const LAYER_TOOLBAR_GAP = 8
const CANVAS_TOOLBAR_STRIP = 48
const LAYER_TOOLBAR_INSET = 8

/**
 * True when the layer's screen rect lies wholly outside the canvas — the
 * toolbar has nothing on screen to belong to, so it hides until the layer
 * pans or zooms back into view. Touching an edge still counts as on screen.
 */
export function layerOffCanvas(
  layer: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
  canvas: Pick<DOMRect, "left" | "top" | "right" | "bottom">
): boolean {
  return (
    layer.right < canvas.left ||
    layer.left > canvas.right ||
    layer.bottom < canvas.top ||
    layer.top > canvas.bottom
  )
}

/**
 * The floating toolbar under a selected frame or Mockup: where it portals to,
 * and the loop that keeps it centred under `anchorRef`. When the layer's bottom
 * is off screen the toolbar stops above the canvas toolbar, and it never slides
 * off the sides. Once the whole layer is off screen the toolbar hides.
 *
 * The portal target is created in canvas.tsx in the popovers layer (above the
 * SelectionOverlay's overlay layer — see the canvas tokens in globals.css), so
 * the toolbar isn't painted over by hover rings or resize handles. Resolved
 * lazily during render: it's only read once the layer is selected, well after
 * the ancestor portal node has mounted, and getElementById returns a stable
 * node reference so dependents don't churn. Returns null while hidden.
 */
export function useLayerToolbar({
  show,
  anchorRef,
  toolbarRef,
}: {
  show: boolean
  anchorRef: RefObject<HTMLElement | null>
  toolbarRef: RefObject<HTMLElement | null>
}): HTMLElement | null {
  const target =
    show && typeof document !== "undefined"
      ? document.getElementById("frame-toolbar-portal")
      : null

  useCanvasAnchoredPortal({
    enabled: !!target,
    anchorRef,
    targetRef: toolbarRef,
    getOffset: (fr, cw) => {
      const width = toolbarRef.current?.offsetWidth ?? 0
      const height = toolbarRef.current?.offsetHeight ?? 0
      const centred = fr.left - cw.left + (fr.width - width) / 2
      return {
        x: Math.max(
          LAYER_TOOLBAR_INSET,
          Math.min(centred, cw.width - width - LAYER_TOOLBAR_INSET)
        ),
        y: Math.min(
          fr.bottom - cw.top + LAYER_TOOLBAR_GAP,
          cw.height - CANVAS_TOOLBAR_STRIP - height
        ),
        hidden: layerOffCanvas(fr, cw),
      }
    },
  })

  return target
}
