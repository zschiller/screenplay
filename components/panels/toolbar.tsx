"use client"

import { Plus, Minus, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ZOOM_MIN, ZOOM_MAX } from "@/lib/constants"
import { useControls } from "react-zoom-pan-pinch"

interface ToolbarProps {
  zoom: number
}

function ZoomControls({ zoom }: { zoom: number }) {
  const { zoomIn, zoomOut, resetTransform } = useControls()

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => zoomOut()}
        disabled={zoom <= ZOOM_MIN}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-12 text-center font-mono text-xs text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => zoomIn()}
        disabled={zoom >= ZOOM_MAX}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => resetTransform()}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function Toolbar({ zoom }: ToolbarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-1.5 shadow-lg backdrop-blur-sm">
      <ZoomControls zoom={zoom} />
    </div>
  )
}
