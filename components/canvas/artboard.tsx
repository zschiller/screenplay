"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MousePointer, Move } from "lucide-react"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import { useScreenplayDom, type PickResult } from "@/hooks/use-screenplay-dom"
import { probeSandboxUrl } from "@/lib/sandbox-actions"
import { ArtboardLabel } from "./artboard-label"
import type { DomRect, JsonObject } from "@/lib/postmessage-protocol"

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
  selected: boolean
  onFocus: (id: string | null) => void
  onSelect: (id: string, shiftKey: boolean) => void
  onMove: (id: string, x: number, y: number) => void
  onMoveSelected: (dx: number, dy: number) => void
  onResize: (id: string, x: number, y: number, w: number, h: number) => void
  onRemove: (id: string) => void
  onStateChanged: (id: string, state: JsonObject) => void
  onRouteChange?: (id: string, route: string) => void
  multiSelected: boolean
  spaceHeld: boolean
  pickMode: boolean
  onPicked: (artboardId: string, sandboxId: string, pick: PickResult) => void
  onHover: (artboardId: string, rect: DomRect | null) => void
}

export function Artboard({
  artboard,
  zoom,
  focused,
  selected,
  onFocus,
  onSelect,
  onMove,
  onMoveSelected,
  onResize,
  onRemove,
  onStateChanged,
  onRouteChange,
  multiSelected,
  spaceHeld,
  pickMode,
  onPicked,
  onHover,
}: ArtboardProps) {
  const handleDrag = useCallback(
    (dx: number, dy: number) => {
      if (selected) {
        onMoveSelected(dx, dy)
      } else {
        onMove(artboard.id, artboard.x + dx, artboard.y + dy)
      }
    },
    [artboard.id, artboard.x, artboard.y, selected, onMove, onMoveSelected],
  )

  const dragHandlers = useArtboardDrag({
    zoom,
    onDrag: handleDrag,
    onClick: (e) => onSelect(artboard.id, e.shiftKey),
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

  // Track the path last reported by the iframe itself. When artboard.route
  // changes to match this path, we know the change was the echo of in-iframe
  // navigation and should not reload the iframe.
  const reportedPathRef = useRef<string | null>(null)

  const handleNavigation = useCallback(
    (id: string, path: string) => {
      reportedPathRef.current = path
      onRouteChange?.(id, path)
    },
    [onRouteChange],
  )

  const { iframeRef } = usePostMessage({
    artboardId: artboard.id,
    iframeState: artboard.iframeState ?? {},
    onStateChanged,
    onNavigation: handleNavigation,
  })

  const dom = useScreenplayDom(iframeRef, {
    onPicked: (p) => onPicked(artboard.id, artboard.sandboxId, p),
    onHover: (rect) => onHover(artboard.id, rect),
  })

  useEffect(() => {
    if (!pickMode) return
    dom.startPick().catch(() => {})
    return () => {
      dom.stopPick().catch(() => {})
    }
  }, [pickMode, dom])

  const desiredSrc = artboard.iframeUrl
    ? artboard.iframeUrl + (artboard.route ?? "")
    : undefined

  // The `src` actually applied to the iframe. We avoid changing it when the
  // route update originated from in-iframe navigation (that would reload the
  // iframe back onto the path it's already on).
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(desiredSrc)

  useEffect(() => {
    if (!artboard.iframeUrl) {
      setIframeSrc(undefined)
      return
    }
    const route = artboard.route ?? ""
    if (route === reportedPathRef.current) return
    setIframeSrc(artboard.iframeUrl + route)
  }, [artboard.iframeUrl, artboard.route])

  const [serverReady, setServerReady] = useState(false)

  useEffect(() => {
    if (!desiredSrc || serverReady) return

    let cancelled = false
    let probes = 0

    async function poll() {
      while (!cancelled && probes < MAX_PROBES) {
        const up = await probeSandboxUrl(desiredSrc!)
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
  }, [desiredSrc, serverReady])

  const HANDLE = 6 // base px thickness of resize handles
  const h = HANDLE / zoom // scale inversely so handles stay usable when zoomed out
  const hHalf = h / 2
  const cornerSize = 12 / zoom

  return (
    <div
      id={`artboard-${artboard.id}`}
      data-artboard
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
        zoom={zoom}
        artboardWidth={artboard.width}
        dragHandlers={focused ? undefined : dragHandlers}
      />
      <button
        onClick={() => onFocus(focused ? null : artboard.id)}
        className={`absolute right-0 bottom-full z-10 flex h-5 w-5 items-center justify-center rounded-sm border text-muted-foreground transition-colors ${focused ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
        style={{
          transform: `scale(${1 / zoom})`,
          transformOrigin: "bottom right",
          marginBottom: 4 / zoom,
        }}
        title={focused ? "Back to canvas mode" : "Interact with app"}
      >
        {focused ? (
          <Move className="h-3 w-3" />
        ) : (
          <MousePointer className="h-3 w-3" />
        )}
      </button>
      <div
        className="relative h-full w-full overflow-hidden"
      >
        {iframeSrc && serverReady ? (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white dark:bg-zinc-900">
            {desiredSrc ? (
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

        {/* Overlay: blocks iframe pointer events when not focused; drag to move, click to select.
            Suppressed during pickMode so the in-iframe picker receives pointer events. */}
        {!focused && !pickMode && (
          <div
            className="absolute inset-0 cursor-default touch-none"
            onPointerDownCapture={(e) => {
              if (e.button === 0 && !spaceHeld) {
                // If already selected, don't narrow selection on pointerdown —
                // let the drag move all selected. Narrow on click (pointerup without drag).
                if (!selected || e.shiftKey) {
                  onSelect(artboard.id, e.shiftKey)
                }
              }
            }}
            {...(spaceHeld ? {} : dragHandlers)}
          />
        )}
      </div>

      {/* Resize handles — only when singly selected and not inspecting */}
      {selected && !multiSelected && !pickMode && (
        <>
          {/* Edges */}
          <div className="absolute cursor-ns-resize touch-none" {...makeHandleProps("n")} style={{ top: -hHalf, left: cornerSize, right: cornerSize, height: h }} />
          <div className="absolute cursor-ns-resize touch-none" {...makeHandleProps("s")} style={{ bottom: -hHalf, left: cornerSize, right: cornerSize, height: h }} />
          <div className="absolute cursor-ew-resize touch-none" {...makeHandleProps("w")} style={{ left: -hHalf, top: cornerSize, bottom: cornerSize, width: h }} />
          <div className="absolute cursor-ew-resize touch-none" {...makeHandleProps("e")} style={{ right: -hHalf, top: cornerSize, bottom: cornerSize, width: h }} />
          {/* Corners */}
          <div className="absolute cursor-nwse-resize touch-none" {...makeHandleProps("nw")} style={{ top: -hHalf, left: -hHalf, width: cornerSize, height: cornerSize }} />
          <div className="absolute cursor-nesw-resize touch-none" {...makeHandleProps("ne")} style={{ top: -hHalf, right: -hHalf, width: cornerSize, height: cornerSize }} />
          <div className="absolute cursor-nesw-resize touch-none" {...makeHandleProps("sw")} style={{ bottom: -hHalf, left: -hHalf, width: cornerSize, height: cornerSize }} />
          <div className="absolute cursor-nwse-resize touch-none" {...makeHandleProps("se")} style={{ bottom: -hHalf, right: -hHalf, width: cornerSize, height: cornerSize }} />
        </>
      )}
    </div>
  )
}
