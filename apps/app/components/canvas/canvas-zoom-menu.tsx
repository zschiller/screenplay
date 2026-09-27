"use client"

import { ChevronDown } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"

import { ZOOM_MAX, ZOOM_MIN } from "@/lib/constants"
import { SHORTCUT_SHEET_KEY, ZOOM_SHORTCUTS } from "@/lib/canvas/shortcuts"

/**
 * The top bar's zoom menu (#734), after Figma's: the live zoom percentage as a
 * plain menu button, opening zoom in / out / fit, the fixed 50 / 100 / 200%
 * stops, and the shortcut sheet. Each item is a thin dispatch into the Canvas
 * Camera verbs the canvas passes in; the key hints read the same
 * {@link ZOOM_SHORTCUTS} the keyboard matches on.
 */
export function CanvasZoomMenu({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onZoomToFit,
  onOpenShortcuts,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomTo: (scale: number) => void
  onZoomToFit: () => void
  onOpenShortcuts: () => void
}) {
  const percent = Math.round(zoom * 100)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Zoom, ${percent}%`}
          className="gap-0.5 px-2 font-normal tabular-nums"
        >
          {percent}%
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          disabled={zoom >= ZOOM_MAX - 1e-3}
          onSelect={onZoomIn}
        >
          Zoom in
          <Keys keys={ZOOM_SHORTCUTS.zoomIn} />
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={zoom <= ZOOM_MIN + 1e-3}
          onSelect={onZoomOut}
        >
          Zoom out
          <Keys keys={ZOOM_SHORTCUTS.zoomOut} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onZoomToFit}>
          Zoom to fit
          <Keys keys={ZOOM_SHORTCUTS.zoomToFit} />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onZoomTo(0.5)}>
          Zoom to 50%
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onZoomTo(1)}>
          Zoom to 100%
          <Keys keys={ZOOM_SHORTCUTS.zoomTo100} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onZoomTo(2)}>
          Zoom to 200%
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenShortcuts}>
          Keyboard shortcuts
          <Keys keys={[SHORTCUT_SHEET_KEY]} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A menu item's key hint: one `Kbd` per key, right-aligned. */
function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <DropdownMenuShortcut className="tracking-normal">
      <KbdGroup>
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
    </DropdownMenuShortcut>
  )
}
