"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Maximize2,
  MousePointer,
  Move,
  Play,
  RotateCw,
  Route,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useDevServerProbe } from "@/hooks/use-dev-server-probe"
import { useIframeLayerDrag } from "@/hooks/use-iframe-layer-drag"
import {
  useIframeLayerResize,
  type ResizeEdge,
} from "@/hooks/use-iframe-layer-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import {
  useScreenplayDom,
  type ScreenplayDom,
  type WheelForward,
} from "@/hooks/use-screenplay-dom"
import { installBridge, getBridgeVersion } from "@/lib/sandbox/provision"
import { DeviceSizeMenu } from "./device-size-menu"
import { IframeLayerLabel } from "./iframe-layer-label"
import { KnobsPopover } from "./knobs-popover"
import { ResizeHandles } from "./resize-handles"
import type { BranchData } from "@/lib/types"
import type {
  DomRect,
  HmrStatus,
  JsonObject,
  JsonValue,
} from "@/lib/postmessage-protocol"

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
  branchId?: string
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
  onMoveGroup: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean
  ) => void
  onMoveSelected: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean
  ) => void
  /** Fires once when a group-move drag actually begins (after the move threshold). */
  onGroupDragStart?: () => void
  /** Fires once when a group-move drag ends. metaKey is the cmd state at release. */
  onGroupDragEnd?: (metaKey: boolean) => void
  /**
   * Attempt to start a reorder drag from a layer-owned element (e.g. the
   * name label). Returns `true` if the reorder took over the pointer (in
   * which case the caller skips its own drag), `false` for single-member
   * groups where reorder doesn't apply.
   */
  onRequestReorderDrag?: (
    iframeLayerId: string,
    e: React.PointerEvent
  ) => boolean
  /**
   * Resize delta. Top/left edges shift the group by (dx, dy); bottom/right
   * edges leave the group anchor in place. The iframeLayer's own width/height
   * always change by (dw, dh). `edge` lets the canvas snap to device-size
   * presets along the axes the user is actually dragging.
   */
  onResize: (
    id: string,
    edge: ResizeEdge,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => void
  /** Fired when a resize gesture begins so the canvas can render the snap underlay. */
  onResizeStart?: (id: string, edge: ResizeEdge) => void
  /** Fired when a resize gesture ends so the canvas can clear the snap underlay. */
  onResizeEnd?: (id: string) => void
  onRemove: (id: string) => void
  /** Inline rename triggered by double-clicking the frame name. */
  onRename?: (id: string, label: string) => void
  onStateChanged: (id: string, state: JsonObject) => void
  onRouteChange?: (id: string, route: string, replace: boolean) => void
  onScrollChange?: (id: string, scrollX: number, scrollY: number) => void
  onKnobsDeclared?: (id: string, knobs: JsonValue[]) => void
  onKnobValuesChange?: (id: string, values: JsonObject) => void
  onSharedStateChanged?: (id: string, state: JsonObject) => void
  /** Open the prototype player route for this iframeLayer's branch in a new tab. */
  onPlay?: (id: string) => void
  /** Resize the frame to match the iframe's documentElement scrollWidth/scrollHeight. */
  onFitToContent?: (id: string, width: number, height: number) => void
  /** Set the frame to an explicit width/height (used by the device-preset menu). */
  onSetSize?: (id: string, width: number, height: number) => void
  multiSelected: boolean
  spaceHeld: boolean
  /** Comment mode shows an element hover overlay so the user can see what
   * element they're about to anchor a comment to. The click falls through
   * to the canvas-level handler that opens the composer. */
  commentMode?: boolean
  onHover: (iframeLayerId: string, rect: DomRect | null) => void
  /**
   * A zoom gesture (pinch / ctrl|cmd-wheel) that landed on the interactive
   * iframe. The bridge cancels the browser's native page zoom and forwards the
   * gesture here so the canvas can zoom itself instead. `wheel.clientX/Y` are in
   * the iframe's own viewport pixels.
   */
  onWheel?: (iframeLayerId: string, wheel: WheelForward) => void
  /**
   * Fired with the iframe DOM accessor on mount and `null` on unmount so the
   * canvas can route selector queries (e.g. for selector-anchored comments)
   * to the right iframeLayer.
   */
  onDomReady?: (iframeLayerId: string, dom: ScreenplayDom | null) => void
  /** Running agents the user can assign to an empty (unassigned) frame. */
  assignableBranches?: BranchData[]
  onAssignBranch?: (iframeLayerId: string, branchId: string) => void
  /** Routes discovered for the agent backing this iframeLayer. */
  discoveredRoutes?: { route: string; label: string }[]
  onSelectRoute?: (iframeLayerId: string, route: string) => void
  /** Group label shown above the branch — only on the leftmost iframeLayer of a multi-iframeLayer group. */
  groupLabel?: string
  /** True when the parent group is selected. Drives label color + group-pink frame. */
  groupSelected?: boolean
  /** Click handler for the group label (only meaningful when `groupLabel` is set). */
  onSelectGroup?: (shiftKey: boolean) => void
  /** Inline rename for the group label (only meaningful when `groupLabel` is set). */
  onRenameGroup?: (next: string) => void
  /**
   * Absolute world-space position of this layer's top-left. Layers render as
   * flat, absolutely-positioned siblings (not nested in a per-group flex row),
   * so moving one between groups never reparents its React subtree — the
   * iframe DOM survives and there's no reload. The position comes from
   * `effectiveIframeLayerLayouts` and already bakes in the pop-out offset.
   */
  worldX: number
  worldY: number
  /** Paint order, projected from the group's sidebar position (higher = on top). */
  zIndex?: number
  /**
   * In-flow reorder translate (world px), layered on top of `worldX/worldY`
   * so the lifted frame tracks the cursor while its siblings reflow to their
   * new slots. Popped drags don't use this — their float position is already
   * baked into `worldX/worldY`.
   */
  dragTranslateX?: number
  dragTranslateY?: number
  /**
   * True while this frame is the one being "popped" out at the cursor (reorder
   * drag with meta held). Drives z-elevation, pointer-events pass-through, and
   * the group label's anchor behavior. Its float position lives in `worldX/Y`.
   */
  dragPopped?: boolean
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
  onGroupDragStart,
  onGroupDragEnd,
  onRequestReorderDrag,
  onResize,
  onResizeStart,
  onResizeEnd,
  onRename,
  onStateChanged,
  onRouteChange,
  onScrollChange,
  onKnobsDeclared,
  onKnobValuesChange,
  onSharedStateChanged,
  onPlay,
  onFitToContent,
  onSetSize,
  multiSelected,
  spaceHeld,
  commentMode,
  onHover,
  onWheel,
  onDomReady,
  assignableBranches,
  onAssignBranch,
  discoveredRoutes,
  onSelectRoute,
  groupLabel,
  groupSelected,
  onSelectGroup,
  onRenameGroup,
  worldX,
  worldY,
  zIndex,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
}: IframeLayerProps) {
  const handleDrag = useCallback(
    (
      dx: number,
      dy: number,
      totalDx: number,
      totalDy: number,
      metaKey: boolean
    ) => {
      if (selected) {
        onMoveSelected(dx, dy, totalDx, totalDy, metaKey)
      } else {
        onMoveGroup(dx, dy, totalDx, totalDy, metaKey)
      }
    },
    [selected, onMoveGroup, onMoveSelected]
  )

  const selectedOnPointerDown = useRef(false)

  const dragHandlers = useIframeLayerDrag({
    zoom,
    onDrag: handleDrag,
    onDragStart: onGroupDragStart,
    onDragEnd: onGroupDragEnd,
    onClick: (e) => {
      if (selectedOnPointerDown.current) {
        selectedOnPointerDown.current = false
        return
      }
      onSelect(iframeLayer.id, e.shiftKey)
    },
  })

  // Separate drag handlers for the *group* label — dragging it translates the
  // whole group (like the frame body) but a release without movement does
  // NOT fall through to the frame's `onSelect` (group selection was already
  // applied on pointerdown). Reuses `handleDrag` so the snap-merge feature
  // still kicks in.
  const groupLabelDragHandlers = useIframeLayerDrag({
    zoom,
    onDrag: handleDrag,
    onDragStart: onGroupDragStart,
    onDragEnd: onGroupDragEnd,
  })

  const handleResize = useCallback(
    (edge: ResizeEdge, dx: number, dy: number, dw: number, dh: number) => {
      onResize(iframeLayer.id, edge, dx, dy, dw, dh)
    },
    [iframeLayer.id, onResize]
  )

  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => {
      onResizeStart?.(iframeLayer.id, edge)
    },
    [iframeLayer.id, onResizeStart]
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

  // Declared here (rather than inside usePostMessage) so callbacks defined
  // above the usePostMessage call below — e.g. reloadIframe — can reference it.
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // True once the in-iframe bridge reports the real page is loaded. This is a
  // postMessage from the iframe itself — no server round-trip — so it's the
  // fastest signal that there's real content to show, and it lets the loading
  // overlay drop the moment the page paints instead of waiting for the probe
  // RPC to come back. The proxy never injects the bridge into its "not ready"
  // placeholder, so this only fires for genuine dev-server pages.
  const [contentReady, setContentReady] = useState(false)

  const handleNavigation = useCallback(
    (id: string, path: string, replace: boolean) => {
      reportedPathRef.current = path
      onRouteChange?.(id, path, replace)
    },
    [onRouteChange]
  )

  const reloadIframe = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    // A reload re-fetches the page, so the current content is no longer "ready"
    // — drop the flag so the overlay re-shows until the bridge reports back.
    setContentReady(false)
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
      // The page is up and interactive — hide the loading overlay immediately,
      // regardless of the bridge-version housekeeping below.
      setContentReady(true)
      if (!iframeLayer.branchId) return
      const expected = await fetchExpectedBridgeVersion()
      if (!expected || expected === reportedVersion) return
      if (reinstalledSandboxes.has(iframeLayer.branchId)) return
      reinstalledSandboxes.add(iframeLayer.branchId)
      const result = await installBridge(iframeLayer.branchId)
      if (!result.success) {
        reinstalledSandboxes.delete(iframeLayer.branchId)
        return
      }
      reloadIframe()
    },
    [iframeLayer.branchId, reloadIframe]
  )

  const [hmrStatus, setHmrStatus] = useState<HmrStatus | null>(null)

  const frameRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Floating action toolbar only mounts when the frame itself is the sole
  // selection. With multiple frames selected we hide every toolbar so the
  // canvas stays clean for group operations. Feature gates (Fit/Play) still
  // hide buttons that don't apply. Reload is always available; it just
  // highlights (default variant) when HMR drops.
  const showToolbar = selected && !multiSelected

  // Portal target is created in canvas.tsx at z-30 (above the SelectionOverlay
  // canvas at z-10), so the toolbar isn't painted over by hover rings or
  // resize handles. Resolved lazily during render — it's only read once the
  // frame is selected (showToolbar), well after the ancestor portal node has
  // mounted, and getElementById returns a stable node reference so dependents
  // don't churn.
  const toolbarPortalTarget =
    typeof document !== "undefined"
      ? document.getElementById("frame-toolbar-portal")
      : null

  // Keep the portaled toolbar anchored to the frame's right edge. The frame
  // lives inside the world transform (panning/zooming change its screen
  // position) but the toolbar lives outside it, so we re-read the frame's
  // client rect every frame while the toolbar is mounted and write the
  // canvas-wrapper-relative offset directly to the toolbar's style.
  useEffect(() => {
    if (!showToolbar || !toolbarPortalTarget) return
    const canvasWrapper = document.querySelector<HTMLDivElement>(
      "[data-canvas-wrapper]"
    )
    if (!canvasWrapper) return
    let rafId = 0
    const tick = () => {
      const frame = frameRef.current
      const toolbar = toolbarRef.current
      if (frame && toolbar) {
        const fr = frame.getBoundingClientRect()
        const cw = canvasWrapper.getBoundingClientRect()
        toolbar.style.transform = `translate(${fr.right - cw.left + 8}px, ${fr.top - cw.top}px)`
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [showToolbar, toolbarPortalTarget])
  const showFit = !!onFitToContent && !!iframeLayer.branchId
  const showPlay = !!onPlay
  const showReload = hmrStatus === "disconnected"

  const handleHmrStatus = useCallback((_id: string, status: HmrStatus) => {
    setHmrStatus(status)
  }, [])

  const handleScroll = useCallback(
    (id: string, scrollX: number, scrollY: number) => {
      onScrollChange?.(id, scrollX, scrollY)
    },
    [onScrollChange]
  )

  usePostMessage({
    iframeRef,
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

  const dom = useScreenplayDom(iframeRef, {
    onWheel: (wheel) => onWheel?.(iframeLayer.id, wheel),
  })

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
  useEffect(() => {
    onDomReadyRef.current = onDomReady
  })
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
      if (x < 0 || y < 0 || x > iframeLayer.width || y > iframeLayer.height)
        return null
      try {
        return await dom.elementAtPoint(x, y)
      } catch {
        return null
      }
    },
    [dom, iframeRef, zoom, iframeLayer.width, iframeLayer.height]
  )

  const desiredSrc = iframeLayer.iframeUrl
    ? iframeLayer.iframeUrl + (iframeLayer.route ?? "")
    : undefined

  // The `src` actually applied to the iframe. We avoid changing it when the
  // route update originated from in-iframe navigation (that would reload the
  // iframe back onto the path it's already on).
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(desiredSrc)

  // This synchronizes the iframe (an external system) with the desired
  // url/route while suppressing reload loops from in-iframe navigation echoes.
  // The decision depends on ref-tracked history (last applied url, last path
  // the iframe reported), which can't be read during render — so it can't move
  // to a render-phase derivation. setState here is the intended sync, not an
  // avoidable cascade.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!iframeLayer.iframeUrl) {
      setIframeSrc(undefined)
      setContentReady(false)
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
      // New page incoming — re-show the overlay until the bridge reports back.
      setContentReady(false)
      setIframeSrc(iframeLayer.iframeUrl + route)
      return
    }
    if (route === reportedPathRef.current) return
    setContentReady(false)
    setIframeSrc(iframeLayer.iframeUrl + route)
  }, [iframeLayer.iframeUrl, iframeLayer.route])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Probe the dev server as an explicit state machine: spinner while
  // `waiting`, the live iframe on `ready`, an actionable error with a working
  // Retry on `timedout` — never an infinite spinner.
  //
  // Keyed on the host (`iframeUrl`), NOT `desiredSrc` (host + route):
  // reachability is a property of the dev server, not the path. Keying on the
  // full route would re-enter `waiting` on every in-iframe navigation, briefly
  // unmounting the iframe and remounting it onto the now-stale `iframeSrc` —
  // which reloads it back onto the previous route. (That stale-src reload was
  // the source of the Create Flow "navigates then snaps back / double frame"
  // bug.) A branch switch still changes `iframeUrl`, so it re-probes correctly.
  const {
    state: probeState,
    readyAfterWait,
    retry: retryProbe,
  } = useDevServerProbe(iframeLayer.iframeUrl)

  // The iframe mounts immediately (see render below) so the warm path paints
  // with zero gating — no waiting on the probe before a `src` is even assigned.
  // The tradeoff: on a cold start the iframe may have loaded the proxy's
  // placeholder before the dev server was up. `readyAfterWait` is true only when
  // the probe succeeded *after* an earlier failure, i.e. exactly that case — so
  // reload once onto the now-live server. The warm path (ready on first probe)
  // never enters here, so there's no reload/flicker.
  useEffect(() => {
    if (probeState === "ready" && readyAfterWait) {
      reloadIframe()
    }
  }, [probeState, readyAfterWait, reloadIframe])

  // Both interact mode and Create Flow mode forward pointer events to the
  // iframe and hide the canvas overlay. Create Flow additionally captures
  // navigation events into a history trail (handled in canvas.tsx).
  const interactive = focused || createFlow

  return (
    <div
      ref={frameRef}
      id={`iframe-layer-${iframeLayer.id}`}
      data-iframe-layer
      className="absolute"
      style={{
        width: iframeLayer.width,
        height: iframeLayer.height,
        // Flat, absolutely-positioned in world space. Moving between groups
        // only changes `worldX/worldY`, never the React parent, so the iframe
        // element is never unmounted/remounted — no reload on pop-out/in.
        left: worldX,
        top: worldY,
        transform:
          dragTranslateX != null || dragTranslateY != null
            ? `translate(${dragTranslateX ?? 0}px, ${dragTranslateY ?? 0}px)`
            : undefined,
        // Dragged/popped frame floats above its siblings; otherwise paint
        // order follows the group's sidebar position.
        zIndex:
          dragPopped || dragTranslateX != null || dragTranslateY != null
            ? 9999
            : zIndex,
        // The lifted frame is non-interactive so drop hit-testing falls
        // through to whatever sits beneath the cursor.
        pointerEvents:
          dragPopped || dragTranslateX != null || dragTranslateY != null
            ? "none"
            : "auto",
      }}
    >
      <IframeLayerLabel
        iframeLayerId={iframeLayer.id}
        label={iframeLayer.label}
        branch={iframeLayer.branch}
        branchId={iframeLayer.branchId}
        route={iframeLayer.route}
        sharedState={iframeLayer.sharedState}
        zoom={zoom}
        iframeLayerWidth={iframeLayer.width}
        dragHandlers={interactive ? undefined : dragHandlers}
        onRequestReorderDrag={interactive ? undefined : onRequestReorderDrag}
        groupLabelDragHandlers={
          interactive ? undefined : groupLabelDragHandlers
        }
        assignableBranches={assignableBranches}
        onAssignBranch={
          onAssignBranch
            ? (branchId) => onAssignBranch(iframeLayer.id, branchId)
            : undefined
        }
        discoveredRoutes={discoveredRoutes}
        onSelectRoute={
          onSelectRoute && iframeLayer.branchId
            ? (route) => onSelectRoute(iframeLayer.id, route)
            : undefined
        }
        selected={selected || groupSelected}
        groupLabel={groupLabel}
        groupSelected={groupSelected}
        onSelectGroup={
          onSelectGroup
            ? (shiftKey) => {
                selectedOnPointerDown.current = true
                onSelectGroup(shiftKey)
              }
            : undefined
        }
        onRenameGroup={onRenameGroup}
        onSelectFrame={(shiftKey) => {
          if (selected && !shiftKey) return
          if (groupSelected && !shiftKey) return
          selectedOnPointerDown.current = true
          onSelect(iframeLayer.id, shiftKey)
        }}
        onRename={
          onRename ? (next) => onRename(iframeLayer.id, next) : undefined
        }
        reorderDragTranslateX={dragTranslateX}
        reorderDragTranslateY={dragTranslateY}
        reorderDragPopped={dragPopped}
      />
      {iframeLayer.branchId &&
        showToolbar &&
        toolbarPortalTarget &&
        createPortal(
          <div
            ref={toolbarRef}
            // Positioned every frame by the rAF loop above (translate is set
            // imperatively from the frame's getBoundingClientRect). Lives
            // outside the world transform, so it's already at constant screen
            // size — no inverse-zoom scaling needed.
            className="pointer-events-auto absolute top-0 left-0 flex flex-col items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xxs"
                    variant={focused ? "default" : "ghost"}
                    onClick={() => onFocus(focused ? null : iframeLayer.id)}
                  >
                    {focused ? <Move /> : <MousePointer />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {focused ? "Back to canvas" : "Interact"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xxs"
                    variant={createFlow ? "default" : "ghost"}
                    onClick={() =>
                      onToggleCreateFlow(createFlow ? null : iframeLayer.id)
                    }
                  >
                    <Route />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {createFlow ? "Stop Create Flow" : "Create Flow"}
                </TooltipContent>
              </Tooltip>
              {onSetSize && (
                <DeviceSizeMenu
                  width={iframeLayer.width}
                  height={iframeLayer.height}
                  onSelect={(w, h) => onSetSize(iframeLayer.id, w, h)}
                />
              )}
              <KnobsPopover
                knobs={iframeLayer.knobs}
                values={iframeLayer.knobValues}
                onChange={(values) =>
                  onKnobValuesChange?.(iframeLayer.id, values)
                }
              />
              {showFit && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xxs"
                      variant="ghost"
                      onClick={handleFitToContent}
                    >
                      <Maximize2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Fit to content</TooltipContent>
                </Tooltip>
              )}
              {showPlay && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-xxs"
                      variant="ghost"
                      onClick={() => onPlay?.(iframeLayer.id)}
                    >
                      <Play />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Open prototype player
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xxs"
                    variant={showReload ? "default" : "ghost"}
                    onClick={reloadIframe}
                  >
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Reload</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>,
          toolbarPortalTarget
        )}
      <div className="relative h-full w-full overflow-hidden">
        {/* Mount the iframe as soon as there's a URL — don't gate it on the
            probe. The probe is a server-action round-trip; gating the mount on
            it meant the browser only started fetching the page *after* the probe
            had already fetched it once, serializing two full loads. Now the
            iframe loads in parallel with the probe and the overlay below just
            hides it until the dev server is confirmed reachable. */}
        {iframeSrc && (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="absolute inset-0 h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ pointerEvents: interactive ? "auto" : "none" }}
          />
        )}
        {/* Overlay covering the still-loading (or placeholder) iframe. It drops
            the instant the iframe's bridge reports the real page is up
            (`contentReady`) — a postMessage, no server round-trip — so the warm
            path doesn't sit on the spinner waiting for the probe RPC to return.
            `probeState === "ready"` is a fallback for pages that load without
            the bridge. A branch can be assigned before its dev server is up, so
            there may be no URL to probe yet — still show the waiting state (the
            probe holds in `waiting` without a URL) so the frame isn't blank. */}
        {!contentReady &&
          probeState !== "ready" &&
          (desiredSrc || iframeLayer.branchId) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-4 text-center dark:bg-zinc-900">
              {probeState === "timedout" ? (
                <>
                  <span className="text-xs font-medium text-foreground">
                    Dev server not responding
                  </span>
                  <span className="max-w-[240px] text-xs text-muted-foreground">
                    The preview couldn&apos;t be reached. It may still be
                    starting up.
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    className="pointer-events-auto mt-1"
                    onClick={retryProbe}
                  >
                    <RotateCw />
                    Retry
                  </Button>
                </>
              ) : (
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
                    const result = await queryElementAtPoint(
                      e.clientX,
                      e.clientY
                    )
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
