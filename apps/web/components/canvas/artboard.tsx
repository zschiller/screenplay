"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { MousePointer, Move, RotateCw, Route } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize, type ResizeEdge } from "@/hooks/use-artboard-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import { useScreenplayDom, type PickResult, type ScreenplayDom } from "@/hooks/use-screenplay-dom"
import { probeSandboxUrl, installBridge, getBridgeVersion } from "@/lib/sandbox-actions"
import { ArtboardLabel } from "./artboard-label"
import { KnobsPopover } from "./knobs-popover"
import type { AgentData } from "@/lib/types"
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
  sandboxId?: string
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
  /** Create Flow mode: iframe is interactive AND each navigation leaves a history clone in the group. */
  createFlow: boolean
  selected: boolean
  onFocus: (id: string | null) => void
  onToggleCreateFlow: (id: string | null) => void
  onSelect: (id: string, shiftKey: boolean) => void
  /** Drag any artboard moves the parent group. */
  onMoveGroup: (dx: number, dy: number) => void
  onMoveSelected: (dx: number, dy: number) => void
  /**
   * Resize delta. Top/left edges shift the group by (dx, dy); bottom/right
   * edges leave the group anchor in place. The artboard's own width/height
   * always change by (dw, dh). `edge` lets the canvas snap to device-size
   * presets along the axes the user is actually dragging.
   */
  onResize: (id: string, edge: ResizeEdge, dx: number, dy: number, dw: number, dh: number) => void
  /** Fired when a resize gesture begins so the canvas can render the snap underlay. */
  onResizeStart?: (id: string, edge: ResizeEdge) => void
  /** Fired when a resize gesture ends so the canvas can clear the snap underlay. */
  onResizeEnd?: (id: string) => void
  onRemove: (id: string) => void
  onStateChanged: (id: string, state: JsonObject) => void
  onRouteChange?: (id: string, route: string) => void
  onScrollChange?: (id: string, scrollX: number, scrollY: number) => void
  onKnobsDeclared?: (id: string, knobs: JsonValue[]) => void
  onKnobValuesChange?: (id: string, values: JsonObject) => void
  multiSelected: boolean
  spaceHeld: boolean
  pickMode: boolean
  /** Comment mode shows the same element hover overlay as inspect, but a
   * click falls through to the canvas-level handler that opens the composer. */
  commentMode?: boolean
  onPicked: (artboardId: string, sandboxId: string, pick: PickResult) => void
  onHover: (artboardId: string, rect: DomRect | null) => void
  /**
   * Fired with the iframe DOM accessor on mount and `null` on unmount so the
   * canvas can route selector queries (e.g. for selector-anchored comments)
   * to the right artboard.
   */
  onDomReady?: (artboardId: string, dom: ScreenplayDom | null) => void
  /** Running agents the user can assign to an empty (unassigned) frame. */
  assignableAgents?: AgentData[]
  onAssignAgent?: (artboardId: string, agentId: string) => void
  /** Routes discovered for the agent backing this artboard. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (artboardId: string, route: string) => void
  /** Group label shown above the branch — only on the leftmost artboard of a multi-artboard group. */
  groupLabel?: string
  /** True when the parent group is selected. Drives label color + group-pink frame. */
  groupSelected?: boolean
  /** Click handler for the group label (only meaningful when `groupLabel` is set). */
  onSelectGroup?: (shiftKey: boolean) => void
  /**
   * CSS `order` for the parent flex row. Lets us render artboards in a stable
   * DOM order (so iframes don't reload) while still showing them in the
   * group's logical left-to-right order via flex.
   */
  flexOrder?: number
  /**
   * World-space offset to translate the artboard while it's being reorder-
   * dragged so its center tracks the cursor. Other siblings still snap to
   * their flex slots; only the lifted artboard floats.
   */
  dragTranslateX?: number
  dragTranslateY?: number
  /**
   * When set, the artboard is "popped" out of its source group — rendered
   * with absolute positioning relative to the parent ArtboardGroup so flex
   * flow drops it and its siblings close the gap. Used during a reorder
   * drag with the meta key held; on release the pop is committed by the
   * canvas (creates a new group). `left`/`top` are relative to the parent
   * ArtboardGroup origin.
   */
  dragPopped?: { left: number; top: number }
}

export function Artboard({
  artboard,
  zoom,
  focused,
  createFlow,
  selected,
  onFocus,
  onToggleCreateFlow,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onResize,
  onResizeStart,
  onResizeEnd,
  onRemove,
  onStateChanged,
  onRouteChange,
  onScrollChange,
  onKnobsDeclared,
  onKnobValuesChange,
  multiSelected,
  spaceHeld,
  pickMode,
  commentMode,
  onPicked,
  onHover,
  onDomReady,
  assignableAgents,
  onAssignAgent,
  discoveredRoutes,
  onSelectRoute,
  groupLabel,
  groupSelected,
  onSelectGroup,
  flexOrder,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
}: ArtboardProps) {
  const handleDrag = useCallback(
    (dx: number, dy: number) => {
      if (selected) {
        onMoveSelected(dx, dy)
      } else {
        onMoveGroup(dx, dy)
      }
    },
    [selected, onMoveGroup, onMoveSelected],
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
    (edge: ResizeEdge, dx: number, dy: number, dw: number, dh: number) => {
      onResize(artboard.id, edge, dx, dy, dw, dh)
    },
    [artboard.id, onResize],
  )

  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => {
      onResizeStart?.(artboard.id, edge)
    },
    [artboard.id, onResizeStart],
  )

  const handleResizeEnd = useCallback(() => {
    onResizeEnd?.(artboard.id)
  }, [artboard.id, onResizeEnd])

  const { makeHandleProps } = useArtboardResize({
    zoom,
    onResize: handleResize,
    onResizeStart: handleResizeStart,
    onResizeEnd: handleResizeEnd,
  })

  // Track the path last reported by the iframe itself. When artboard.route
  // changes to match this path, we know the change was the echo of in-iframe
  // navigation and should not reload the iframe.
  const reportedPathRef = useRef<string | null>(null)

  // Track the iframeUrl applied last so we can distinguish a branch switch
  // (host change) from a route-only change.
  const lastIframeUrlRef = useRef<string | undefined>(artboard.iframeUrl)

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
      if (!artboard.sandboxId) return
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

  const frameRef = useRef<HTMLDivElement>(null)
  const buttonsRef = useRef<HTMLDivElement>(null)

  // Natural (unconstrained) width of the label's bottom row — reported by
  // ArtboardLabel from a hidden measurement copy. Used to decide which action
  // buttons fit in the remaining space.
  const [labelContentWidth, setLabelContentWidth] = useState(0)

  // Measured widths of each individual button. Wrappers around each button
  // give us a direct ref to read offsetWidth; cached so a hidden button keeps
  // its last-known width (we still know whether it would have fit).
  const interactWrapperRef = useRef<HTMLDivElement>(null)
  const createFlowWrapperRef = useRef<HTMLDivElement>(null)
  const knobsWrapperRef = useRef<HTMLDivElement>(null)
  const reloadWrapperRef = useRef<HTMLDivElement>(null)
  const [buttonNaturalWidths, setButtonNaturalWidths] = useState<{
    interact: number
    createFlow: number
    knobs: number
    reload: number
  }>({ interact: 0, createFlow: 0, knobs: 0, reload: 0 })
  useLayoutEffect(() => {
    setButtonNaturalWidths((prev) => {
      const next = {
        interact: interactWrapperRef.current?.offsetWidth ?? prev.interact,
        createFlow: createFlowWrapperRef.current?.offsetWidth ?? prev.createFlow,
        knobs: knobsWrapperRef.current?.offsetWidth ?? prev.knobs,
        reload: reloadWrapperRef.current?.offsetWidth ?? prev.reload,
      }
      if (
        next.interact === prev.interact &&
        next.createFlow === prev.createFlow &&
        next.knobs === prev.knobs &&
        next.reload === prev.reload
      ) {
        return prev
      }
      return next
    })
  })

  // Decide which action buttons fit using the actual measured widths of the
  // label content + each button. Computed synchronously every render so the
  // label's reservedRightPx and the visible button set stay in lockstep —
  // using a ResizeObserver here would lag a frame and the label would briefly
  // truncate at the threshold before the button disappears.
  const BUTTON_GAP = 2 // gap-0.5 between buttons (must match className below)
  const BUTTON_MARGIN = 8 // breathing room between label and the button row
  const space = Math.max(
    0,
    artboard.width * zoom - labelContentWidth - BUTTON_MARGIN,
  )
  const interactW = buttonNaturalWidths.interact
  const createFlowW = buttonNaturalWidths.createFlow
  const knobsW = buttonNaturalWidths.knobs
  const reloadW = buttonNaturalWidths.reload
  const showInteract = !interactW || space >= interactW
  const showCreateFlow =
    showInteract &&
    (!createFlowW || space >= interactW + BUTTON_GAP + createFlowW)
  const showKnobs =
    showCreateFlow &&
    (!knobsW ||
      space >= interactW + BUTTON_GAP + createFlowW + BUTTON_GAP + knobsW)
  const showReload =
    hmrStatus === "disconnected" &&
    showKnobs &&
    (!reloadW ||
      space >=
        interactW +
          BUTTON_GAP +
          createFlowW +
          BUTTON_GAP +
          knobsW +
          BUTTON_GAP +
          reloadW)
  const visibleButtonsTotal = (() => {
    const widths: number[] = []
    if (showInteract && interactW) widths.push(interactW)
    if (showCreateFlow && createFlowW) widths.push(createFlowW)
    if (showKnobs && knobsW) widths.push(knobsW)
    if (showReload && reloadW) widths.push(reloadW)
    return widths.reduce(
      (sum, w, i) => sum + w + (i > 0 ? BUTTON_GAP : 0),
      0,
    )
  })()
  const reservedRightPx = visibleButtonsTotal
    ? visibleButtonsTotal + BUTTON_MARGIN
    : 0

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

  const onDomReadyRef = useRef(onDomReady)
  onDomReadyRef.current = onDomReady
  useEffect(() => {
    onDomReadyRef.current?.(artboard.id, dom)
    return () => onDomReadyRef.current?.(artboard.id, null)
  }, [artboard.id, dom])

  const queryElementAtPoint = useCallback(
    async (clientX: number, clientY: number) => {
      const iframe = iframeRef.current
      if (!iframe) return null
      const rect = iframe.getBoundingClientRect()
      // The iframe is rendered inside a zoom-transformed canvas, so its
      // getBoundingClientRect is the visually scaled size. The iframe's
      // internal viewport (and what elementFromPoint uses) is unscaled, so we
      // divide by zoom to convert from screen pixels back to iframe-viewport
      // pixels. Without this the hit-test drifts further off as zoom shrinks.
      const x = (clientX - rect.left) / zoom
      const y = (clientY - rect.top) / zoom
      if (x < 0 || y < 0 || x > artboard.width || y > artboard.height) return null
      try {
        return await dom.elementAtPoint(x, y)
      } catch {
        return null
      }
    },
    [dom, iframeRef, zoom, artboard.width, artboard.height],
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
      lastIframeUrlRef.current = undefined
      return
    }
    const route = artboard.route ?? ""
    const urlChanged = lastIframeUrlRef.current !== artboard.iframeUrl
    if (urlChanged) {
      // Branch switch: force a reload onto the new host even if the route
      // matches what the previous iframe last reported.
      lastIframeUrlRef.current = artboard.iframeUrl
      reportedPathRef.current = null
      setIframeSrc(artboard.iframeUrl + route)
      return
    }
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

  // Both interact mode and Create Flow mode forward pointer events to the
  // iframe and hide the canvas overlay. Create Flow additionally captures
  // navigation events into a history trail (handled in canvas.tsx).
  const interactive = focused || createFlow

  return (
    <div
      ref={frameRef}
      id={`artboard-${artboard.id}`}
      data-artboard
      className="relative shrink-0"
      style={{
        width: artboard.width,
        height: artboard.height,
        order: flexOrder,
        position: dragPopped ? "absolute" : undefined,
        left: dragPopped?.left,
        top: dragPopped?.top,
        transform:
          dragPopped
            ? undefined
            : dragTranslateX != null || dragTranslateY != null
              ? `translate(${dragTranslateX ?? 0}px, ${dragTranslateY ?? 0}px)`
              : undefined,
        zIndex: dragPopped || dragTranslateX != null || dragTranslateY != null ? 5 : undefined,
        // Other siblings snap to their new flex slots; the lifted artboard
        // tracks the cursor without a transition so it doesn't lag.
        pointerEvents:
          dragPopped || dragTranslateX != null || dragTranslateY != null ? "none" : undefined,
      }}
    >
      <ArtboardLabel
        label={artboard.label}
        branch={artboard.branch}
        sandboxId={artboard.sandboxId}
        route={artboard.route}
        zoom={zoom}
        artboardWidth={artboard.width}
        reservedRightPx={reservedRightPx}
        dragHandlers={interactive ? undefined : dragHandlers}
        hmrStatus={hmrStatus}
        assignableAgents={assignableAgents}
        onAssignAgent={onAssignAgent ? (agentId) => onAssignAgent(artboard.id, agentId) : undefined}
        discoveredRoutes={discoveredRoutes}
        onSelectRoute={
          onSelectRoute && artboard.sandboxId
            ? (route) => onSelectRoute(artboard.id, route)
            : undefined
        }
        selected={selected || groupSelected}
        groupLabel={groupLabel}
        groupSelected={groupSelected}
        onSelectGroup={onSelectGroup ? (shiftKey) => {
          selectedOnPointerDown.current = true
          onSelectGroup(shiftKey)
        } : undefined}
        onSelectFrame={(shiftKey) => {
          if (selected && !shiftKey) return
          if (groupSelected && !shiftKey) return
          selectedOnPointerDown.current = true
          onSelect(artboard.id, shiftKey)
        }}
        onContentWidthChange={setLabelContentWidth}
      />
      {artboard.sandboxId && (
        <div
          ref={buttonsRef}
          // row-reverse keeps the visual order [Reload, Knobs, Interact].
          // clip-path lets the knob's override-dot extend ~4px above the row.
          className="absolute right-0 bottom-full z-10 flex h-5 flex-row-reverse items-center gap-0.5"
          style={{
            transform: `scale(${1 / zoom})`,
            transformOrigin: "bottom right",
            marginBottom: 2 / zoom,
            clipPath: "inset(-4px 0 0 0)",
          }}
        >
          {showInteract && (
            <div ref={interactWrapperRef} className="flex">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xxs"
                      variant={focused ? "default" : "outline"}
                      onClick={() => onFocus(focused ? null : artboard.id)}
                    >
                      {focused ? <Move /> : <MousePointer />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {focused ? "Back to canvas" : "Interact"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {showCreateFlow && (
            <div ref={createFlowWrapperRef} className="flex">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xxs"
                      variant={createFlow ? "default" : "outline"}
                      onClick={() =>
                        onToggleCreateFlow(createFlow ? null : artboard.id)
                      }
                    >
                      <Route />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {createFlow ? "Stop Create Flow" : "Create Flow"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {showKnobs && (
            <div ref={knobsWrapperRef} className="flex">
              <KnobsPopover
                knobs={artboard.knobs}
                values={artboard.knobValues}
                onChange={(values) => onKnobValuesChange?.(artboard.id, values)}
                anchorRef={frameRef}
              />
            </div>
          )}
          {showReload && (
            <div ref={reloadWrapperRef} className="flex">
              <Button size="xxs" onClick={reloadIframe}>
                <RotateCw />
                Reload
              </Button>
            </div>
          )}
        </div>
      )}
      <div
        className="relative h-full w-full overflow-hidden"
      >
        {iframeSrc && serverReady ? (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ pointerEvents: interactive ? "auto" : "none" }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white dark:bg-zinc-900">
            {desiredSrc && (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                <span className="text-xs text-muted-foreground">
                  Waiting for dev server...
                </span>
              </>
            )}
          </div>
        )}

        {/* Overlay sits above the iframe (which is pointer-events:none unless
            focused). In pickMode it forwards pointer tracking to the in-iframe
            picker via postMessage; otherwise handles drag-to-move / click. */}
        {!interactive && (
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
                    if (!artboard.sandboxId) return
                    const result = await queryElementAtPoint(e.clientX, e.clientY)
                    if (result) onPicked(artboard.id, artboard.sandboxId, result)
                  },
                }
              : commentMode && !spaceHeld
                ? {
                    // Hover-only: show the inspect overlay so the user can see
                    // what element they're about to comment on. The click is
                    // handled by the canvas-level handleCanvasClick (which
                    // also re-runs elementAtPoint to capture the selector).
                    onPointerMove: async (e: React.PointerEvent) => {
                      const result = await queryElementAtPoint(e.clientX, e.clientY)
                      onHover(artboard.id, result ? result.rect : null)
                    },
                    onPointerLeave: () => onHover(artboard.id, null),
                  }
                : {})}
            onPointerDownCapture={(e) => {
              if (pickMode) return
              if (e.button === 0 && !spaceHeld) {
                selectedOnPointerDown.current = false
                // When the parent group is selected, defer selection to the
                // click handler so a drag here moves the whole group instead
                // of piercing to this child frame.
                if (groupSelected && !e.shiftKey) return
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
