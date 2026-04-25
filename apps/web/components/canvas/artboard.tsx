"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MousePointer, Move, RotateCw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import { useScreenplayDom, type PickResult } from "@/hooks/use-screenplay-dom"
import { probeSandboxUrl, installBridge, getBridgeVersion } from "@/lib/sandbox-actions"
import { ArtboardLabel } from "./artboard-label"
import { KnobsPopover } from "./knobs-popover"
import type { DomRect, HmrStatus, JsonObject, JsonValue } from "@/lib/postmessage-protocol"

const PROBE_INTERVAL_MS = 2000
const MAX_PROBES = 60 // ~2 minutes

// Cached expected bridge version — fetched once per session.
let expectedBridgeVersionPromise: Promise<string> | null = null
function fetchExpectedBridgeVersion(): Promise<string> {
  if (!expectedBridgeVersionPromise) {
    expectedBridgeVersionPromise = getBridgeVersion().catch(() => "")
  }
  return expectedBridgeVersionPromise
}

// Per-sandbox reinstall guard so a stale bridge only triggers one reinstall
// cycle — avoids a loop if a sandbox somehow can't serve the fresh file.
const reinstalledSandboxes = new Set<string>()

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
  scrollX?: number
  scrollY?: number
  branch?: string
  knobs?: JsonValue[]
  knobValues?: JsonObject
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
  onScrollChange?: (id: string, scrollX: number, scrollY: number) => void
  onKnobsDeclared?: (id: string, knobs: JsonValue[]) => void
  onKnobValuesChange?: (id: string, values: JsonObject) => void
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
  onScrollChange,
  onKnobsDeclared,
  onKnobValuesChange,
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

  const selectedOnPointerDown = useRef(false)

  const dragHandlers = useArtboardDrag({
    zoom,
    onDrag: handleDrag,
    onClick: (e) => {
      if (selectedOnPointerDown.current) {
        selectedOnPointerDown.current = false
        return
      }
      onSelect(artboard.id, e.shiftKey)
    },
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

  const reloadIframe = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    // Cross-origin iframe: cycle src through about:blank to force a full
    // reload that re-fetches bridge.js and the dev server page.
    const src = iframe.src
    iframe.src = "about:blank"
    requestAnimationFrame(() => {
      const i = iframeRef.current
      if (i) i.src = src
    })
  }, [])

  const handleReady = useCallback(
    async (_id: string, reportedVersion: string | undefined) => {
      const expected = await fetchExpectedBridgeVersion()
      if (!expected || expected === reportedVersion) return
      if (reinstalledSandboxes.has(artboard.sandboxId)) return
      reinstalledSandboxes.add(artboard.sandboxId)
      const result = await installBridge(artboard.sandboxId)
      if (!result.success) {
        reinstalledSandboxes.delete(artboard.sandboxId)
        return
      }
      reloadIframe()
    },
    [artboard.sandboxId, reloadIframe],
  )

  const [hmrStatus, setHmrStatus] = useState<HmrStatus | null>(null)

  const handleHmrStatus = useCallback((_id: string, status: HmrStatus) => {
    setHmrStatus(status)
  }, [])

  const handleScroll = useCallback(
    (id: string, scrollX: number, scrollY: number) => {
      onScrollChange?.(id, scrollX, scrollY)
    },
    [onScrollChange],
  )

  const { iframeRef } = usePostMessage({
    artboardId: artboard.id,
    iframeState: artboard.iframeState ?? {},
    iframeScrollX: artboard.scrollX,
    iframeScrollY: artboard.scrollY,
    knobValues: artboard.knobValues,
    onStateChanged,
    onNavigation: handleNavigation,
    onScroll: handleScroll,
    onReady: handleReady,
    onHmrStatus: handleHmrStatus,
    onKnobsDeclared,
  })

  const dom = useScreenplayDom(iframeRef)

  const queryElementAtPoint = useCallback(
    async (clientX: number, clientY: number) => {
      const iframe = iframeRef.current
      if (!iframe) return null
      const rect = iframe.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
      try {
        return await dom.elementAtPoint(x, y)
      } catch {
        return null
      }
    },
    [dom, iframeRef],
  )

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
        hmrStatus={hmrStatus}
      />
      <div
        className="absolute right-0 bottom-full z-10 flex items-center gap-1"
        style={{
          transform: `scale(${1 / zoom})`,
          transformOrigin: "bottom right",
          marginBottom: 4 / zoom,
        }}
      >
        {hmrStatus === "disconnected" && (
          <Button size="xs" onClick={reloadIframe}>
            <RotateCw />
            Reload
          </Button>
        )}
        <KnobsPopover
          knobs={artboard.knobs}
          values={artboard.knobValues}
          onChange={(values) => onKnobValuesChange?.(artboard.id, values)}
        />
        <button
          onClick={() => onFocus(focused ? null : artboard.id)}
          className={`flex h-5 w-5 items-center justify-center rounded-sm border text-muted-foreground transition-colors ${focused ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
          title={focused ? "Back to canvas mode" : "Interact with app"}
        >
          {focused ? (
            <Move className="h-3 w-3" />
          ) : (
            <MousePointer className="h-3 w-3" />
          )}
        </button>
      </div>
      <div
        className="relative h-full w-full overflow-hidden"
      >
        {iframeSrc && serverReady ? (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ pointerEvents: focused ? "auto" : "none" }}
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

        {/* Overlay sits above the iframe (which is pointer-events:none unless
            focused). In pickMode it forwards pointer tracking to the in-iframe
            picker via postMessage; otherwise handles drag-to-move / click. */}
        {!focused && (
          <div
            className="absolute inset-0 touch-none"
            style={{ cursor: "inherit" }}
            {...(pickMode || spaceHeld ? {} : dragHandlers)}
            {...(pickMode && !spaceHeld
              ? {
                  onPointerMove: async (e: React.PointerEvent) => {
                    const result = await queryElementAtPoint(e.clientX, e.clientY)
                    onHover(artboard.id, result ? result.rect : null)
                  },
                  onPointerLeave: () => onHover(artboard.id, null),
                  onClickCapture: async (e: React.MouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const result = await queryElementAtPoint(e.clientX, e.clientY)
                    if (result) onPicked(artboard.id, artboard.sandboxId, result)
                  },
                }
              : {})}
            onPointerDownCapture={(e) => {
              if (pickMode) return
              if (e.button === 0 && !spaceHeld) {
                selectedOnPointerDown.current = false
                if (!selected || e.shiftKey) {
                  selectedOnPointerDown.current = true
                  onSelect(artboard.id, e.shiftKey)
                }
              }
            }}
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
