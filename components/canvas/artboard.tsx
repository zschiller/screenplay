"use client"

import { useCallback } from "react"
import { MousePointer, Move } from "lucide-react"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { usePostMessage } from "@/hooks/use-postmessage"
import { ArtboardLabel } from "./artboard-label"
import type { JsonObject } from "@/lib/postmessage-protocol"

export interface ArtboardData {
  id: string
  sandboxId: string
  x: number
  y: number
  width: number
  height: number
  label: string
  iframeUrl?: string
  iframeState?: JsonObject
  route?: string
  branch?: string
}

interface ArtboardProps {
  artboard: ArtboardData
  zoom: number
  focused: boolean
  onFocus: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onRemove: (id: string) => void
  onStateChanged: (id: string, state: JsonObject) => void
}

export function Artboard({
  artboard,
  zoom,
  focused,
  onFocus,
  onMove,
  onRemove,
  onStateChanged,
}: ArtboardProps) {
  const handleDrag = useCallback(
    (dx: number, dy: number) => {
      onMove(artboard.id, artboard.x + dx, artboard.y + dy)
    },
    [artboard.id, artboard.x, artboard.y, onMove],
  )

  const dragHandlers = useArtboardDrag({
    zoom,
    onDrag: handleDrag,
  })

  const { iframeRef } = usePostMessage({
    artboardId: artboard.id,
    iframeState: artboard.iframeState ?? {},
    onStateChanged,
  })

  const src = artboard.iframeUrl
    ? artboard.iframeUrl + (artboard.route ?? "")
    : undefined

  return (
    <div
      className="absolute"
      style={{
        left: artboard.x,
        top: artboard.y,
        width: artboard.width,
        height: artboard.height,
      }}
    >
      <ArtboardLabel
        label={artboard.label}
        branch={artboard.branch}
        onClose={() => onRemove(artboard.id)}
      />
      <button
        onClick={() => onFocus(focused ? null : artboard.id)}
        className={`absolute -right-1 -top-7 z-10 flex h-5 w-5 items-center justify-center rounded-sm border text-muted-foreground transition-colors ${focused ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
        title={focused ? "Back to canvas mode" : "Interact with app"}
      >
        {focused ? (
          <Move className="h-3 w-3" />
        ) : (
          <MousePointer className="h-3 w-3" />
        )}
      </button>
      <div
        className={`relative h-full w-full overflow-hidden rounded-lg border shadow-sm ${focused ? "border-primary" : "border-border"}`}
      >
        {src ? (
          <iframe
            ref={iframeRef}
            src={src}
            className="h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white text-sm text-muted-foreground dark:bg-zinc-900">
            {artboard.label}
          </div>
        )}

        {/* Overlay: captures pointer events for drag/pan. Double-click to focus and interact with iframe. */}
        {!focused && (
          <div
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            {...dragHandlers}
          />
        )}
      </div>
    </div>
  )
}
