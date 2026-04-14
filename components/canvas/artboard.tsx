"use client"

import { useCallback, useEffect, useState } from "react"
import { MousePointer, Move } from "lucide-react"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import { probeSandboxUrl } from "@/lib/sandbox-actions"
import { ArtboardLabel } from "./artboard-label"
import type { JsonObject } from "@/lib/postmessage-protocol"

const PROBE_INTERVAL_MS = 2000
const MAX_PROBES = 60 // ~2 minutes

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
  onResize: (id: string, x: number, y: number, w: number, h: number) => void
  onRemove: (id: string) => void
  onStateChanged: (id: string, state: JsonObject) => void
}

export function Artboard({
  artboard,
  zoom,
  focused,
  onFocus,
  onMove,
  onResize,
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

  const handleResize = useCallback(
    (dx: number, dy: number, dw: number, dh: number) => {
      onResize(
        artboard.id,
        artboard.x + dx,
        artboard.y + dy,
        artboard.width + dw,
        artboard.height + dh,
      )
    },
    [artboard.id, artboard.x, artboard.y, artboard.width, artboard.height, onResize],
  )

  const { makeHandleProps } = useArtboardResize({
    zoom,
    onResize: handleResize,
  })

  const { iframeRef } = usePostMessage({
    artboardId: artboard.id,
    iframeState: artboard.iframeState ?? {},
    onStateChanged,
  })

  const src = artboard.iframeUrl
    ? artboard.iframeUrl + (artboard.route ?? "")
    : undefined

  const [serverReady, setServerReady] = useState(false)

  useEffect(() => {
    if (!src || serverReady) return

    let cancelled = false
    let probes = 0

    async function poll() {
      while (!cancelled && probes < MAX_PROBES) {
        const up = await probeSandboxUrl(src!)
        if (up && !cancelled) {
          setServerReady(true)
          return
        }
        probes++
        await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
      }
    }

    poll()
    return () => { cancelled = true }
  }, [src, serverReady])

  const HANDLE = 6 // px thickness of resize handles

  return (
    <div
      id={`artboard-${artboard.id}`}
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
        sandboxId={artboard.sandboxId}
        route={artboard.route}
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
        {src && serverReady ? (
          <iframe
            ref={iframeRef}
            src={src}
            className="h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white dark:bg-zinc-900">
            {src ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                <span className="text-xs text-muted-foreground">
                  Waiting for dev server...
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                {artboard.label}
              </span>
            )}
          </div>
        )}

        {/* Overlay: captures pointer events for drag/pan */}
        {!focused && (
          <div
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            {...dragHandlers}
          />
        )}
      </div>

      {/* Resize handles — edges */}
      <div className="absolute -top-[3px] left-2 right-2 h-[6px] cursor-n-resize" {...makeHandleProps("n")} style={{ height: HANDLE }} />
      <div className="absolute -bottom-[3px] left-2 right-2 h-[6px] cursor-s-resize" {...makeHandleProps("s")} style={{ height: HANDLE }} />
      <div className="absolute -left-[3px] top-2 bottom-2 w-[6px] cursor-w-resize" {...makeHandleProps("w")} style={{ width: HANDLE }} />
      <div className="absolute -right-[3px] top-2 bottom-2 w-[6px] cursor-e-resize" {...makeHandleProps("e")} style={{ width: HANDLE }} />

      {/* Resize handles — corners */}
      <div className="absolute -top-[3px] -left-[3px] h-3 w-3 cursor-nw-resize" {...makeHandleProps("nw")} />
      <div className="absolute -top-[3px] -right-[3px] h-3 w-3 cursor-ne-resize" {...makeHandleProps("ne")} />
      <div className="absolute -bottom-[3px] -left-[3px] h-3 w-3 cursor-sw-resize" {...makeHandleProps("sw")} />
      <div className="absolute -bottom-[3px] -right-[3px] h-3 w-3 cursor-se-resize" {...makeHandleProps("se")} />
    </div>
  )
}
