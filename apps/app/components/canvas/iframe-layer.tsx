"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Maximize2,
  MoreHorizontal,
  MousePointer,
  Move,
  Play,
  RotateCw,
  Route,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useCanvasAnchoredPortal } from "@/hooks/use-canvas-anchored-portal"
import { useDevServerProbe } from "@/hooks/use-dev-server-probe"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import {
  useScreenplayDom,
  type ScreenplayDom,
  type WheelForward,
} from "@/hooks/use-screenplay-dom"
import { installBridge, getBridgeVersion } from "@/lib/sandbox/provision"
import { OpenInBrowserItem } from "../open-in-browser-item"
import { DeviceSizeSubMenu } from "./device-size-menu"
import { IframeLayerLabel } from "./iframe-layer-label"
import { KnobsPopover } from "./knobs-popover"
import { LayerShell } from "./layer-shell"
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

// Grace between the probe reporting the dev server reachable and reloading an
// iframe that still hasn't reported a real page via the bridge. Long enough for
// a page that's genuinely mid-load to fire `contentReady` first (no needless
// reload on the warm path), short enough that recovering a stuck placeholder
// feels immediate.
const PLACEHOLDER_RELOAD_GRACE_MS = 1500

// Cap on placeholder-recovery reloads. The cold-start window has several
// transient failure modes (the proxy serves its placeholder again, the upstream
// resets mid-buffer, the route is still compiling on demand), and a single
// reload occasionally lands in one of them — leaving the frame white forever.
// `contentReady` stops the loop the moment a real page paints, so a healthy
// frame reloads at most once; the cap only bounds a genuinely stuck server.
const MAX_PLACEHOLDER_RELOADS = 10

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
  /**
   * Open this frame's live preview in the system browser, deep-linked to the
   * route it's currently showing — preferring portless's stable named URL over
   * the port-based proxy URL. Bound by the canvas (which has the frame's Branch
   * and Repo); absent until the frame has a live preview to open.
   */
  onOpenInBrowser?: () => void
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
  /**
   * Thumbnail-capture bookkeeping (#474). `onCaptureReadyChange` reports the
   * frame's content-ready transitions (first load, and the reload after a
   * route/branch change), so the heartbeat marks it dirty and recaptures it.
   * `onCaptureDirty` reports an in-place change with no ready transition — an
   * HMR reconnect — so a frame that's already loaded still gets recaptured.
   */
  onCaptureReadyChange?: (iframeLayerId: string, ready: boolean) => void
  onCaptureDirty?: (iframeLayerId: string) => void
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
  /** Color of a remote user who has this frame selected — tints the name to
   *  match their selection rect. Ignored while locally selected. */
  remoteSelectedColor?: string
  /** Color of a remote user who has this frame's group selected — tints the
   *  group label. Only meaningful on the leftmost member. */
  remoteGroupSelectedColor?: string
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
  onOpenInBrowser,
  onFitToContent,
  onSetSize,
  multiSelected,
  spaceHeld,
  commentMode,
  onHover,
  onWheel,
  onDomReady,
  onCaptureReadyChange,
  onCaptureDirty,
  assignableBranches,
  onAssignBranch,
  discoveredRoutes,
  onSelectRoute,
  groupLabel,
  groupSelected,
  remoteSelectedColor,
  remoteGroupSelectedColor,
  onSelectGroup,
  onRenameGroup,
  worldX,
  worldY,
  zIndex,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
}: IframeLayerProps) {
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

  // The URL the iframe is *supposed* to show. reloadIframe reloads onto this,
  // not the DOM's current `iframe.src`: a prior recovery reload may have parked
  // the frame on about:blank (a backgrounded window can pause the restore rAF),
  // and reading the live `src` would then reload it right back to about:blank —
  // white forever. Synced from `iframeSrc` (defined below) in an effect.
  const iframeSrcRef = useRef<string | undefined>(undefined)

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
    // reload that re-fetches bridge.js and the dev server page. Reload onto the
    // *intended* URL (see iframeSrcRef) so a frame already stuck on about:blank
    // doesn't reload back onto about:blank.
    const src = iframeSrcRef.current
    if (!src) return
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

  // Keep the portaled toolbar anchored to the frame's right edge.
  useCanvasAnchoredPortal({
    enabled: showToolbar && !!toolbarPortalTarget,
    anchorRef: frameRef,
    targetRef: toolbarRef,
    getOffset: (fr, cw) => ({ x: fr.right - cw.left + 8, y: fr.top - cw.top }),
  })
  const showFit = !!onFitToContent && !!iframeLayer.branchId
  const showPlay = !!onPlay
  // Open the frame's live preview in a real browser tab, deep-linked to the
  // route it's currently showing — the same page the iframe loads, minus the
  // prototype-player wrapper. The canvas binds `onOpenInBrowser` only when the
  // frame has a live preview (and a Branch/Repo to resolve the portless URL),
  // so its presence is the gate.
  const showOpenInBrowser = !!onOpenInBrowser
  const showReload = hmrStatus === "disconnected"
  // The `…` drawer holds low-frequency frame config (Device Size, Fit) and
  // Branch-scoped "open" actions (prototype player, open in browser). Hidden
  // only while every item it would hold is absent.
  const showOverflow = !!onSetSize || showFit || showPlay || showOpenInBrowser

  // Report content-ready transitions up to the thumbnail heartbeat (#474). The
  // first paint and the re-paint after a route/branch change (which drops
  // `contentReady` then reports it again) both flow through here, so the
  // heartbeat marks the frame dirty and recaptures just it. Stored in a ref so
  // the effect fires on the value, not on identity churn of the callback.
  const onCaptureReadyChangeRef = useRef(onCaptureReadyChange)
  useEffect(() => {
    onCaptureReadyChangeRef.current = onCaptureReadyChange
  })
  useEffect(() => {
    onCaptureReadyChangeRef.current?.(iframeLayer.id, contentReady)
  }, [iframeLayer.id, contentReady])

  // An HMR reconnect (`reconnecting`/`disconnected` → `connected`) means the
  // dev server bounced and the preview most likely changed without a full
  // reload — the closest signal the bridge gives us to "HMR applied an update"
  // (it observes the HMR channel's open/close, not its message payloads). Mark
  // the frame dirty so a loaded frame still gets recaptured.
  const onCaptureDirtyRef = useRef(onCaptureDirty)
  useEffect(() => {
    onCaptureDirtyRef.current = onCaptureDirty
  })
  const prevHmrStatusRef = useRef<HmrStatus | null>(null)
  const handleHmrStatus = useCallback(
    (_id: string, status: HmrStatus) => {
      const prev = prevHmrStatusRef.current
      prevHmrStatusRef.current = status
      setHmrStatus(status)
      if (status === "connected" && prev !== null && prev !== "connected") {
        onCaptureDirtyRef.current?.(iframeLayer.id)
      }
    },
    [iframeLayer.id]
  )

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

  // Counts placeholder-recovery reloads for the current `iframeSrc`. Bumping it
  // re-arms the recovery effect's timer (so it retries rather than firing once),
  // and it resets to 0 below whenever a fresh page starts loading.
  const [recoveryTick, setRecoveryTick] = useState(0)

  // Keep iframeSrcRef pointing at the intended URL for reloadIframe, and give
  // each fresh load its own recovery budget.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    iframeSrcRef.current = iframeSrc
    setRecoveryTick(0)
  }, [iframeSrc])
  /* eslint-enable react-hooks/set-state-in-effect */

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
  const { state: probeState, retry: retryProbe } = useDevServerProbe(
    iframeLayer.iframeUrl
  )

  // The iframe mounts immediately (see render below) so the warm path paints
  // with zero gating — no waiting on the probe before a `src` is even assigned.
  // The tradeoff: on a cold start the iframe may have fetched the proxy's
  // placeholder (or hit a connection-refused) before the dev server was up. The
  // placeholder never carries the bridge, so `contentReady` can't fire on its
  // own to clear it — and we can't gate the recovery on the probe's
  // failed-then-succeeded heuristic, because the probe is a server-action
  // round-trip whose first attempt routinely resolves *after* the dev server
  // bound the port (reporting ready-on-first-try) even though the iframe's own
  // in-browser fetch already painted the placeholder.
  //
  // So drive the recovery off the authoritative signal: the probe says the
  // server is reachable, yet the bridge still hasn't reported a real page
  // (`contentReady`). That means the iframe is sitting on the placeholder/blank
  // it loaded too early — reload onto the now-live server. The short grace lets
  // a real page that's merely mid-load report `contentReady` first, so the warm
  // path never reloads/flickers.
  //
  // Retry rather than reload once: the cold-start window has several transient
  // failure modes (the proxy serves its placeholder again, the upstream resets
  // mid-buffer, a backgrounded window paused the restore rAF and left the frame
  // on about:blank). A single reload occasionally lands in one of them and the
  // frame stays white forever. Each attempt bumps `recoveryTick`, which re-arms
  // this effect for the next try; `contentReady` (reliable — the bridge posts
  // `screenplay:ready` synchronously and the parent listener is always mounted
  // first) ends the loop the instant a real page paints, so a healthy frame
  // reloads at most once. The cap only bounds a genuinely stuck server.
  useEffect(() => {
    if (probeState !== "ready" || contentReady) return
    if (recoveryTick >= MAX_PLACEHOLDER_RELOADS) return
    const id = setTimeout(() => {
      reloadIframe()
      setRecoveryTick((n) => n + 1)
    }, PLACEHOLDER_RELOAD_GRACE_MS)
    return () => clearTimeout(id)
  }, [probeState, contentReady, recoveryTick, reloadIframe])

  // Both interact mode and Create Flow mode forward pointer events to the
  // iframe and hide the canvas overlay. Create Flow additionally captures
  // navigation events into a history trail (handled in canvas.tsx).
  const interactive = focused || createFlow

  return (
    <LayerShell
      layerId={iframeLayer.id}
      width={iframeLayer.width}
      height={iframeLayer.height}
      worldX={worldX}
      worldY={worldY}
      zIndex={zIndex}
      dragTranslateX={dragTranslateX}
      dragTranslateY={dragTranslateY}
      dragPopped={dragPopped}
      containerId={`iframe-layer-${iframeLayer.id}`}
      containerClassName="absolute"
      containerRef={frameRef}
      containerProps={{ "data-iframe-layer": "" }}
      zoom={zoom}
      selected={selected}
      groupSelected={groupSelected}
      multiSelected={multiSelected}
      spaceHeld={spaceHeld}
      onSelect={onSelect}
      onMoveGroup={onMoveGroup}
      onMoveSelected={onMoveSelected}
      onGroupDragStart={onGroupDragStart}
      onGroupDragEnd={onGroupDragEnd}
      onRequestReorderDrag={onRequestReorderDrag}
      // Interactive (focus / Create Flow) frames forward pointers to the iframe,
      // so the title bar's drag is detached just like the body overlay is hidden.
      titleDragDisabled={interactive}
      onResize={onResize}
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
      groupLabel={groupLabel}
      remoteGroupSelectedColor={remoteGroupSelectedColor}
      onSelectGroup={onSelectGroup}
      onRenameGroup={onRenameGroup}
      renderTitle={(api) => (
        <IframeLayerLabel
          label={iframeLayer.label}
          branch={iframeLayer.branch}
          branchId={iframeLayer.branchId}
          route={iframeLayer.route}
          sharedState={iframeLayer.sharedState}
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
          remoteSelectedColor={remoteSelectedColor}
          onSelectFrame={(shiftKey) => {
            if (selected && !shiftKey) return
            if (groupSelected && !shiftKey) return
            api.deferSelect(shiftKey)
          }}
          onRename={
            onRename ? (next) => onRename(iframeLayer.id, next) : undefined
          }
        />
      )}
    >
      {(api) => (
        <>
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
                  {/* interaction modes above ∣ everything else below */}
                  <div className="my-0.5 h-px w-full bg-foreground/10" />
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
                  <KnobsPopover
                    knobs={iframeLayer.knobs}
                    values={iframeLayer.knobValues}
                    onChange={(values) =>
                      onKnobValuesChange?.(iframeLayer.id, values)
                    }
                  />
                  {showOverflow && (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-xxs" variant="ghost">
                              <MoreHorizontal className="text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right">More</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        sideOffset={8}
                      >
                        {onSetSize && (
                          <DeviceSizeSubMenu
                            width={iframeLayer.width}
                            height={iframeLayer.height}
                            onSelect={(w, h) => onSetSize(iframeLayer.id, w, h)}
                          />
                        )}
                        {showFit && (
                          <DropdownMenuItem onSelect={handleFitToContent}>
                            <Maximize2 />
                            Fit to content
                          </DropdownMenuItem>
                        )}
                        {(!!onSetSize || showFit) &&
                          (showPlay || showOpenInBrowser) && (
                            <DropdownMenuSeparator />
                          )}
                        {showPlay && (
                          <DropdownMenuItem
                            onSelect={() => onPlay?.(iframeLayer.id)}
                          >
                            <Play />
                            Open prototype player
                          </DropdownMenuItem>
                        )}
                        {onOpenInBrowser && (
                          <OpenInBrowserItem onOpen={onOpenInBrowser} />
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TooltipProvider>
              </div>,
              toolbarPortalTarget
            )}
          <div className="relative h-full w-full overflow-hidden bg-white dark:bg-zinc-900">
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
            Crucially it stays up while recovery is still reloading (probe ready
            but no real page yet, under the cap): otherwise the bridge-less proxy
            placeholder — an unstyled "Dev server not yet ready" — flashes
            through, as does the about:blank white between reload cycles. Once
            recovery is exhausted the overlay drops so a genuinely stuck server
            doesn't sit under an infinite spinner. A branch can be assigned
            before its dev server is up, so there may be no URL to probe yet —
            still show the waiting state (the probe holds in `waiting` without a
            URL) so the frame isn't blank. */}
            {!contentReady &&
              (probeState !== "ready" ||
                recoveryTick < MAX_PLACEHOLDER_RELOADS) &&
              (desiredSrc || iframeLayer.branchId) && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-4 text-center dark:bg-zinc-900">
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
                {...api.bodyDragHandlers}
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
                onPointerDownCapture={api.onBodyPointerDownCapture}
              />
            )}
          </div>
        </>
      )}
    </LayerShell>
  )
}
