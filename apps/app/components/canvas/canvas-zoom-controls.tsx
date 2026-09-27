"use client"

import { Keyboard, Minus, Plus, Scan } from "lucide-react"

import {
  FloatingToolbar,
  FloatingToolbarButton,
} from "@workspace/ui/components/floating-toolbar"

import { ZOOM_MAX, ZOOM_MIN } from "@/lib/constants"
import { SHORTCUT_SHEET_KEY, ZOOM_SHORTCUTS } from "@/lib/canvas/shortcuts"

/**
 * The zoom pill beside the bottom toolbar (#734): the live zoom percentage
 * (click for 100%), zoom out / in, zoom to fit, and the shortcut sheet. Every
 * button is a thin dispatch into the Canvas Camera verbs the canvas passes in;
 * the tooltips read the same {@link ZOOM_SHORTCUTS} the keyboard matches on.
 */
export function CanvasZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomTo100,
  onZoomToFit,
  onOpenShortcuts,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomTo100: () => void
  onZoomToFit: () => void
  onOpenShortcuts: () => void
}) {
  const percent = Math.round(zoom * 100)
  return (
    <FloatingToolbar
      aria-label="Zoom"
      className="[&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0"
      onClick={(e) => e.stopPropagation()}
    >
      <FloatingToolbarButton
        label="Zoom out"
        shortcut={ZOOM_SHORTCUTS.zoomOut}
        disabled={zoom <= ZOOM_MIN + 1e-3}
        onClick={onZoomOut}
      >
        <Minus />
      </FloatingToolbarButton>
      <FloatingToolbarButton
        label="Zoom to 100%"
        shortcut={ZOOM_SHORTCUTS.zoomTo100}
        size="xs"
        className="w-11 px-0 font-normal tabular-nums"
        onClick={onZoomTo100}
      >
        {percent}%
      </FloatingToolbarButton>
      <FloatingToolbarButton
        label="Zoom in"
        shortcut={ZOOM_SHORTCUTS.zoomIn}
        disabled={zoom >= ZOOM_MAX - 1e-3}
        onClick={onZoomIn}
      >
        <Plus />
      </FloatingToolbarButton>
      <FloatingToolbarButton
        label="Zoom to fit"
        shortcut={ZOOM_SHORTCUTS.zoomToFit}
        onClick={onZoomToFit}
      >
        <Scan />
      </FloatingToolbarButton>
      <FloatingToolbarButton
        label="Keyboard shortcuts"
        shortcut={SHORTCUT_SHEET_KEY}
        onClick={onOpenShortcuts}
      >
        <Keyboard />
      </FloatingToolbarButton>
    </FloatingToolbar>
  )
}
