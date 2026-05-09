"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Maximize2, MousePointer, Move, Play, RotateCw, Route } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useIframeLayerDrag } from "@/hooks/use-iframe-layer-drag"
import { useIframeLayerResize, type ResizeEdge } from "@/hooks/use-iframe-layer-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import { useScreenplayDom, type ScreenplayDom } from "@/hooks/use-screenplay-dom"
import { probeSandboxUrl, installBridge, getBridgeVersion } from "@/lib/sandbox-actions"
import { IframeLayerLabel } from "./iframe-layer-label"
import { KnobsPopover } from "./knobs-popover"
import { ResizeHandles } from "./resize-handles"
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

export interface IframeLayerData {
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
  sharedState?: JsonObject
}

interface IframeLayerProps {
  iframeLayer: IframeLayerData
  zoom: number
  focused: boolean
  /** Create Flow mode: iframe is interactive AND each navigation leaves a history clone in the group. */
  createFlow: boolean
  selected: boolean
  onFocus: (id: string | null) => void
  onToggleCreateFlow: (id: string | null) => void
  onSelect: (id: string, shiftKey: boolean) => void
  /** Drag any iframeLayer moves the parent group. */
  onMoveGroup: (dx: number, dy: number) => void
  onMoveSelected: (dx: number, dy: number) => void
  /**
   * Resize delta. Top/left edges shift the group by (dx, dy); bottom/right
   * edges leave the group anchor in place. The iframeLayer's own width/height
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
  onSharedStateChanged?: (id: string, state: JsonObject) => void
  /** Open the prototype player route for this iframeLayer's branch in a new tab. */
  onPlay?: (id: string) => void
  /** Resize the frame to match the iframe's documentElement scrollWidth/scrollHeight. */
  onFitToContent?: (id: string, width: number, height: number) => void
  multiSelected: boolean
  spaceHeld: boolean
  /** Comment mode shows an element hover overlay so the user can see what
   * element they're about to anchor a comment to. The click falls through
   * to the canvas-level handler that opens the composer. */
  commentMode?: boolean
  onHover: (iframeLayerId: string, rect: DomRect | null) => void
  /**
   * Fired with the iframe DOM accessor on mount and `null` on unmount so the
   * canvas can route selector queries (e.g. for selector-anchored comments)
   * to the right iframeLayer.
   */
  onDomReady?: (iframeLayerId: string, dom: ScreenplayDom | null) => void
  /** Running agents the user can assign to an empty (unassigned) frame. */
  assignableAgents?: AgentData[]
  onAssignAgent?: (iframeLayerId: string, agentId: string) => void
  /** Routes discovered for the agent backing this iframeLayer. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (iframeLayerId: string, route: string) => void
  /** Group label shown above the branch — only on the leftmost iframeLayer of a multi-iframeLayer group. */
  groupLabel?: string
  /** True when the parent group is selected. Drives label color + group-pink frame. */
  groupSelected?: boolean
  /** Click handler for the group label (only meaningful when `groupLabel` is set). */
  onSelectGroup?: (shiftKey: boolean) => void
  /**
   * CSS `order` for the parent flex row. Lets us render iframeLayers in a stable
   * DOM order (so iframes don't reload) while still showing them in the
   * group's logical left-to-right order via flex.
   */
  flexOrder?: number
  /**
   * World-space offset to translate the iframeLayer while it's being reorder-
   * dragged so its center tracks the cursor. Other siblings still snap to
   * their flex slots; only the lifted iframeLayer floats.
   */
  dragTranslateX?: number
  dragTranslateY?: number
  /**
   * When set, the iframeLayer is "popped" out of its source group — rendered
   * with absolute positioning relative to the parent IframeLayerGroup so flex
   * flow drops it and its siblings close the gap. Used during a reorder
   * drag with the meta key held; on release the pop is committed by the
   * canvas (creates a new group). `left`/`top` are relative to the parent
   * IframeLayerGroup origin.
   */
  dragPopped?: { left: number; top: number }
}

export function IframeLayer({
  iframeLayer,
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
  onSharedStateChanged,
  onPlay,
  onFitToContent,
  multiSelected,
  spaceHeld,
  commentMode,
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
}: IframeLayerProps) {
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

  const dragHandlers = useIframeLayerDrag({
    zoom,
    onDrag: handleDrag,
    onClick: (e) => {
      if (selectedOnPointerDown.current) {
        selectedOnPointerDown.current = false
        return
      }
      onSelect(iframeLayer.id, e.shiftKey)
    },
  })

  const handleResize = useCallback(
    (edge: ResizeEdge, dx: number, dy: number, dw: number, dh: number) => {
      onResize(iframeLayer.id, edge, dx, dy, dw, dh)
    },
    [iframeLayer.id, onResize],
  )

  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => {
      onResizeStart?.(iframeLayer.id, edge)
    },
    [iframeLayer.id, onResizeStart],
  )

  const handleResizeEnd = useCallback(() => {
    onResizeEnd?.(iframeLayer.id)
  }, [iframeLayer.id, onResizeEnd])

  const { makeHandleProps } = useIframeLayerResize({
    zoom,
    onResize: handleResize,
    onResizeStart: handleResizeStart,
    onResizeEnd: handleResizeEnd,
  })

  // Track the path last reported by the iframe itself. When iframeLayer.route
  // changes to match this path, we know the change was the echo of in-iframe
  // navigation and should not reload the iframe.
  const reportedPathRef = useRef<string | null>(null)

  // Track the iframeUrl applied last so we can distinguish a branch switch
  // (host change) from a route-only change.
  const lastIframeUrlRef = useRef<string | undefined>(iframeLayer.iframeUrl)

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
      if (!iframeLayer.sandboxId) return
      const expected = await fetchExpectedBridgeVersion()
      if (!expected || expected === reportedVersion) return
      if (reinstalledSandboxes.has(iframeLayer.sandboxId)) return
      reinstalledSandboxes.add(iframeLayer.sandboxId)
      const result = await installBridge(iframeLayer.sandboxId)
      if (!result.success) {
        reinstalledSandboxes.delete(iframeLayer.sandboxId)
        return
      }
      reloadIframe()
    },
    [iframeLayer.sandboxId, reloadIframe],
  )

  const [hmrStatus, setHmrStatus] = useState<HmrStatus | null>(null)

  const frameRef = useRef<HTMLDivElement>(null)
  const buttonsRef = useRef<HTMLDivElement>(null)

  // Natural (unconstrained) width of the label's bottom row — reported by
  // IframeLayerLabel from a hidden measurement copy. Used to decide which action
  // buttons fit in the remaining space.
  const [labelContentWidth, setLabelContentWidth] = useState(0)

  // Measured widths of each individual button. Wrappers around each button
  // give us a direct ref to read offsetWidth; cached so a hidden button keeps
  // its last-known width (we still know whether it would have fit).
  const interactWrapperRef = useRef<HTMLDivElement>(null)
  const createFlowWrapperRef = useRef<HTMLDivElement>(null)
  const knobsWrapperRef = useRef<HTMLDivElement>(null)
  const fitWrapperRef = useRef<HTMLDivElement>(null)
  const playWrapperRef = useRef<HTMLDivElement>(null)
  const reloadWrapperRef = useRef<HTMLDivElement>(null)
  const [buttonNaturalWidths, setButtonNaturalWidths] = useState<{
    interact: number
    createFlow: number
    knobs: number
    fit: number
    play: number
    reload: number
  }>({ interact: 0, createFlow: 0, knobs: 0, fit: 0, play: 0, reload: 0 })
  useLayoutEffect(() => {
    setButtonNaturalWidths((prev) => {
      const next = {
        interact: interactWrapperRef.current?.offsetWidth ?? prev.interact,
        createFlow: createFlowWrapperRef.current?.offsetWidth ?? prev.createFlow,
        knobs: knobsWrapperRef.current?.offsetWidth ?? prev.knobs,
        fit: fitWrapperRef.current?.offsetWidth ?? prev.fit,
        play: playWrapperRef.current?.offsetWidth ?? prev.play,
        reload: reloadWrapperRef.current?.offsetWidth ?? prev.reload,
      }
      if (
        next.interact === prev.interact &&
        next.createFlow === prev.createFlow &&
        next.knobs === prev.knobs &&
        next.fit === prev.fit &&
        next.play === prev.play &&
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
    iframeLayer.width * zoom - labelContentWidth - BUTTON_MARGIN,
  )
  const interactW = buttonNaturalWidths.interact
  const createFlowW = buttonNaturalWidths.createFlow
  const knobsW = buttonNaturalWidths.knobs
  const fitW = buttonNaturalWidths.fit
  const playW = buttonNaturalWidths.play
  const reloadW = buttonNaturalWidths.reload
  const canFit = !!onFitToContent && !!iframeLayer.sandboxId
  const showInteract = !interactW || space >= interactW
  const showCreateFlow =
    showInteract &&
    (!createFlowW || space >= interactW + BUTTON_GAP + createFlowW)
  const showKnobs =
    showCreateFlow &&
    (!knobsW ||
      space >= interactW + BUTTON_GAP + createFlowW + BUTTON_GAP + knobsW)
  const showFit =
    canFit &&
    showKnobs &&
    (!fitW ||
      space >=
        interactW +
          BUTTON_GAP +
          createFlowW +
          BUTTON_GAP +
          knobsW +
          BUTTON_GAP +
          fitW)
  const showPlay =
    !!onPlay &&
    showKnobs &&
    (!playW ||
      space >=
        interactW +
          BUTTON_GAP +
          createFlowW +
          BUTTON_GAP +
          knobsW +
          BUTTON_GAP +
          (showFit && fitW ? fitW + BUTTON_GAP : 0) +
          playW)
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
          (showFit && fitW ? fitW + BUTTON_GAP : 0) +
          (showPlay && playW ? playW + BUTTON_GAP : 0) +
          reloadW)
  const visibleButtonsTotal = (() => {
    const widths: number[] = []
    if (showInteract && interactW) widths.push(interactW)
    if (showCreateFlow && createFlowW) widths.push(createFlowW)
    if (showKnobs && knobsW) widths.push(knobsW)
    if (showFit && fitW) widths.push(fitW)
    if (showPlay && playW) widths.push(playW)
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
    iframeLayerId: iframeLayer.id,
    iframeState: iframeLayer.iframeState ?? {},
    iframeScrollX: iframeLayer.scrollX,
    iframeScrollY: iframeLayer.scrollY,
    knobValues: iframeLayer.knobValues,
    sharedState: iframeLayer.sharedState,
    onStateChanged,
    onNavigation: handleNavigation,
    onScroll: handleScroll,
    onReady: handleReady,
    onHmrStatus: handleHmrStatus,
    onKnobsDeclared,
    onSharedStateChanged,
  })

  const dom = useScreenplayDom(iframeRef)

  const handleFitToContent = useCallback(async () => {
    try {
      const size = await dom.getDocumentSize()
      if (!size) return
      onFitToContent?.(iframeLayer.id, size.width, size.height)
    } catch {
      // Bridge timeout / iframe not ready — ignore.
    }
  }, [dom, iframeLayer.id, onFitToContent])

  const onDomReadyRef = useRef(onDomReady)
  onDomReadyRef.current = onDomReady
  useEffect(() => {
    onDomReadyRef.current?.(iframeLayer.id, dom)
    return () => onDomReadyRef.current?.(iframeLayer.id, null)
  }, [iframeLayer.id, dom])

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
      if (x < 0 || y < 0 || x > iframeLayer.width || y > iframeLayer.height) return null
      try {
        return await dom.elementAtPoint(x, y)
      } catch {
        return null
      }
    },
    [dom, iframeRef, zoom, iframeLayer.width, iframeLayer.height],
  )

  const desiredSrc = iframeLayer.iframeUrl
    ? iframeLayer.iframeUrl + (iframeLayer.route ?? "")
    : undefined

  // The `src` actually applied to the iframe. We avoid changing it when the
  // route update originated from in-iframe navigation (that would reload the
  // iframe back onto the path it's already on).
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(desiredSrc)

  useEffect(() => {
    if (!iframeLayer.iframeUrl) {
      setIframeSrc(undefined)
      lastIframeUrlRef.current = undefined
      return
    }
    const route = iframeLayer.route ?? ""
    const urlChanged = lastIframeUrlRef.current !== iframeLayer.iframeUrl
    if (urlChanged) {
      // Branch switch: force a reload onto the new host even if the route
      // matches what the previous iframe last reported.
      lastIframeUrlRef.current = iframeLayer.iframeUrl
      reportedPathRef.current = null
      setIframeSrc(iframeLayer.iframeUrl + route)
      return
    }
    if (route === reportedPathRef.current) return
    setIframeSrc(iframeLayer.iframeUrl + route)
  }, [iframeLayer.iframeUrl, iframeLayer.route])

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

  // Both interact mode and Create Flow mode forward pointer events to the
  // iframe and hide the canvas overlay. Create Flow additionally captures
  // navigation events into a history trail (handled in canvas.tsx).
  const interactive = focused || createFlow

  return (
    <div
      ref={frameRef}
      id={`iframe-layer-${iframeLayer.id}`}
      data-iframe-layer
      className="relative shrink-0"
      style={{
        width: iframeLayer.width,
        height: iframeLayer.height,
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
        // Other siblings snap to their new flex slots; the lifted iframeLayer
        // tracks the cursor without a transition so it doesn't lag.
        pointerEvents:
          dragPopped || dragTranslateX != null || dragTranslateY != null ? "none" : undefined,
      }}
    >
      <IframeLayerLabel
        label={iframeLayer.label}
        branch={iframeLayer.branch}
        sandboxId={iframeLayer.sandboxId}
        route={iframeLayer.route}
        sharedState={iframeLayer.sharedState}
        zoom={zoom}
        iframeLayerWidth={iframeLayer.width}
        reservedRightPx={reservedRightPx}
        dragHandlers={interactive ? undefined : dragHandlers}
        hmrStatus={hmrStatus}
        assignableAgents={assignableAgents}
        onAssignAgent={onAssignAgent ? (agentId) => onAssignAgent(iframeLayer.id, agentId) : undefined}
        discoveredRoutes={discoveredRoutes}
        onSelectRoute={
          onSelectRoute && iframeLayer.sandboxId
            ? (route) => onSelectRoute(iframeLayer.id, route)
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
          onSelect(iframeLayer.id, shiftKey)
        }}
        onContentWidthChange={setLabelContentWidth}
      />
      {iframeLayer.sandboxId && (
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
                      onClick={() => onFocus(focused ? null : iframeLayer.id)}
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
                        onToggleCreateFlow(createFlow ? null : iframeLayer.id)
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
                knobs={iframeLayer.knobs}
                values={iframeLayer.knobValues}
                onChange={(values) => onKnobValuesChange?.(iframeLayer.id, values)}
                anchorRef={frameRef}
              />
            </div>
          )}
          {showFit && (
            <div ref={fitWrapperRef} className="flex">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xxs"
                      variant="outline"
                      onClick={handleFitToContent}
                    >
                      <Maximize2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Fit to content
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {showPlay && (
            <div ref={playWrapperRef} className="flex">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xxs"
                      variant="outline"
                      onClick={() => onPlay?.(iframeLayer.id)}
                    >
                      <Play />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Open prototype player
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
            focused). Handles drag-to-move / click; in comment mode it also
            forwards pointer tracking to the in-iframe picker so the canvas
            can render an element hover overlay. */}
        {!interactive && (
          <div
            className="absolute inset-0 touch-none"
            style={{ cursor: "inherit" }}
            {...(spaceHeld ? {} : dragHandlers)}
            {...(commentMode && !spaceHeld
              ? {
                  // Hover-only: show the inspect overlay so the user can see
                  // what element they're about to comment on. The click is
                  // handled by the canvas-level handleCanvasClick (which
                  // also re-runs elementAtPoint to capture the selector).
                  onPointerMove: async (e: React.PointerEvent) => {
                    const result = await queryElementAtPoint(e.clientX, e.clientY)
                    onHover(iframeLayer.id, result ? result.rect : null)
                  },
                  onPointerLeave: () => onHover(iframeLayer.id, null),
                }
              : {})}
            onPointerDownCapture={(e) => {
              if (e.button === 0 && !spaceHeld) {
                selectedOnPointerDown.current = false
                // When the parent group is selected, defer selection to the
                // click handler so a drag here moves the whole group instead
                // of piercing to this child frame.
                if (groupSelected && !e.shiftKey) return
                if (!selected || e.shiftKey) {
                  selectedOnPointerDown.current = true
                  onSelect(iframeLayer.id, e.shiftKey)
                }
              }
            }}
          />
        )}
      </div>

      {/* Resize handles — only when singly selected. */}
      {selected && !multiSelected && (
        <ResizeHandles zoom={zoom} makeHandleProps={makeHandleProps} />
      )}
    </div>
  )
}
