"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeftIcon, ArrowRightIcon } from "@workspace/ui/components/icons"
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarSeparator,
} from "@workspace/ui/components/floating-toolbar"
import { resolveFrameStage } from "@/components/frame-status/frame-stage"
import { FrameStatus } from "@/components/frame-status/frame-status"
import { useDevServerProbe } from "@/hooks/use-dev-server-probe"
import { useViewing } from "@/lib/viewer/context"
import { useViewerFrame } from "@/lib/viewer/use-viewer-frame"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import type { ScreenplayDom, WheelForward } from "@/hooks/use-screenplay-dom"
import {
  canGoBack,
  canGoForward,
  createRouteHistory,
  currentRoute,
  goBack,
  goForward,
  visitRoute,
  type RouteHistory,
} from "@/lib/canvas/route-history"
import { installBridge, getBridgeVersion } from "@/lib/sandbox/provision"
import type { EditableTextHandle } from "@workspace/ui/components/editable-text"
import { FrameAddressBar, type FramePreviewStatus } from "./frame-nav"
import type { GroupLabelValue } from "./group-label"
import { IframeLayerLabel } from "./iframe-layer-label"
import {
  LayerMenu,
  useRegisterLayerMenu,
  type LayerMenuActions,
} from "./layer-menu"
import {
  LivePageContent,
  LivePageControls,
  LivePageOverlay,
  livePageChrome,
  useLivePage,
  type LivePageWrites,
} from "./live-page"
import type { FrameStreamConnection } from "@/lib/frame-stream/client"
import type { FrameDriverView, FrameRequesterView } from "./use-frame-control"
import { recordsLiveRoute } from "@/lib/canvas/frame-control"
import { useLayerToolbar } from "./use-layer-toolbar"
import { LayerShell, type LayerPlacement } from "./layer-shell"
import type { BranchData } from "@/lib/types"
import type {
  DomRect,
  HmrStatus,
  JsonObject,
  JsonValue,
} from "@/lib/postmessage-protocol"

const UNASSIGNED_IN_GROUP =
  "Choose a chat from the group’s title to preview its code here."
/** The unanswered frame's copy when it can start a chat (#1358). */
const START_A_CHAT =
  "Start a chat to build something here, or choose one from the frame’s title."
const START_A_CHAT_IN_GROUP =
  "Start a chat to build something here, or choose one from the group’s title."

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
  /** The Workspace behind `iframeUrl`, which the dev server probe asks about. */
  workspace?: { sandboxName: string; devPort: number }
  iframeState?: JsonObject
  route?: string
  scrollX?: number
  scrollY?: number
  knobs?: JsonValue[]
  knobValues?: JsonObject
  sharedState?: JsonObject
  colorScheme?: "light" | "dark"
  fitHeight?: boolean
}

const NOBODY_DRIVES: FrameDriverView = { kind: "none" }

interface IframeLayerProps {
  iframeLayer: IframeLayerData
  zoom: number
  focused: boolean
  /** Who drives the frame (#1387). Someone else driving it shows their mark on
   *  Interact, the title-line tag, and no resize handles. */
  driver?: FrameDriverView
  /** This viewer asked the person driving for control (#1395). */
  askedForControl?: boolean
  /** People asking this viewer, the driver, for control (#1395). */
  controlRequests?: readonly FrameRequesterView[]
  /** Give control / Not now on a request for control. */
  onGrantControl?: (layerId: string, to: string) => void
  onDeclineControl?: (layerId: string, to: string) => void
  /** This viewer's input reached the shared frame (Frame Control's idle
   *  clock). */
  onControlActivity?: (layerId: string) => void
  /**
   * Set while this viewer sees the frame live (#1392, #1516): one shared
   * browser in the Sandbox, shown from its Frame Stream instead of this
   * viewer's own iframe.
   */
  sharedStream?: FrameStreamConnection
  /** Someone turned the frame live, for everyone: the title line says Live
   *  (#1516). */
  live?: boolean
  /** Who drives the live copy, for the title-line tag and the resize handles
   *  of a viewer on their own copy. */
  liveDriver?: FrameDriverView
  /** Go live or end it, for everyone (the Go live toggle). Absent where frames can't go live:
   *  the desktop app, `SHARED_FRAMES=off`. */
  onToggleLive?: () => void
  /** This viewer turned the frame live and waits for its first picture
   *  (#1520): the toggle spins. */
  liveStarting?: boolean
  /** Create Flow mode: iframe is interactive AND each navigation leaves a history clone in the group. */
  createFlow: boolean
  selected: boolean
  onFocus: (id: string | null) => void
  onToggleCreateFlow: (id: string | null) => void
  onSelect: (id: string, shiftKey: boolean) => void
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
  /** Where the page's Knobs and shared state are written. */
  writes?: LivePageWrites
  /** Set a shared frame's Theme knob. */
  onColorSchemeChange?: (id: string, scheme: "light" | "dark") => void
  /** Open the play mode route for this iframeLayer's branch in a new tab. */
  onPlay?: (id: string) => void
  /**
   * Open this frame's live preview in the system browser, deep-linked to the
   * route it's currently showing — preferring portless's stable named URL over
   * the port-based proxy URL. Bound by the canvas (which has the frame's Branch
   * and Repo); absent until the frame has a live preview to open.
   */
  onOpenInBrowser?: () => void
  /** Append a copy of this frame to its group (the frame menu's Duplicate). */
  onDuplicate?: () => void
  /** Start an "add a knob" request in this frame's Workspace chat. */
  onAskForKnob?: () => void
  /** Turn Fit to content on (at the page's content height) or off. */
  onSetFitToContent?: (id: string, on: boolean, height?: number) => void
  /** The page's content height, while Fit to content is on. */
  onFollowContentHeight?: (id: string, height: number) => void
  /** Set the frame to an explicit width/height (used by the device-preset menu). */
  onSetSize?: (id: string, width: number, height: number) => void
  multiSelected: boolean
  spaceHeld: boolean
  /** Comment mode shows an element hover overlay so the user can see what
   * element they're about to anchor a comment to. The click falls through
   * to the canvas-level handler that opens the composer. */
  commentMode?: boolean
  /**
   * True while an element pick is armed for a branch this frame is eligible for.
   * Like comment mode, it shows the element hover overlay so the user can see
   * what they're about to target; the click falls through to the canvas-level
   * pick handler. Ineligible frames get `dimmed` instead and don't hover-track.
   */
  pickActive?: boolean
  /**
   * True while an element pick is armed for a *different* branch, so this frame
   * can't be targeted (#619). Dims the frame body to make the eligible frames
   * stand out; purely visual — the canvas-level hit-test already ignores it.
   */
  dimmed?: boolean
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
  /**
   * The assigned Workspace's lifecycle, which picks the status screen the frame
   * shows over its preview (issue #731). Unset when the frame has no Workspace.
   */
  workspace?: Pick<BranchData, "status" | "statusMessage" | "error">
  /** Restart the frame's Workspace (failed or stopped). */
  onRestartWorkspace?: (branchId: string) => void
  /** Show the frame's Workspace's sandbox logs. */
  onOpenLogs?: (branchId: string) => void
  /** Start a chat on the frame while it has no Workspace: select it and
   *  reopen its ask card (#1358). Unset when there's no Repo to start in. */
  onStartChat?: (iframeLayerId: string) => void
  /** The chat prompt is open on this frame: a scrim dims and blurs the frame
   *  behind it, like a dialog's overlay. */
  asking?: boolean
  /** Running agents the user can assign to an empty (unassigned) frame. */
  assignableBranches?: BranchData[]
  onAssignBranch?: (iframeLayerId: string, branchId: string) => void
  /** Routes discovered for the agent backing this iframeLayer. */
  discoveredRoutes?: { route: string; label: string }[]
  /** Navigate the frame; `replace` edits the route in place and never leaves
   *  a Create Flow trail (back and forward use it). */
  onSelectRoute?: (
    iframeLayerId: string,
    route: string,
    replace?: boolean
  ) => void
  /** The group label shown above the branch — only on the leftmost
   *  iframeLayer of a multi-iframeLayer group. */
  groupLabel?: GroupLabelValue
  /** The frame names its own Workspace on its label: its Group's frames
   *  differ, or it is a Group of one with no group label (#1276). */
  showWorkspace?: boolean
  /** True when the parent group is selected. Drives label color + group-pink frame. */
  groupSelected?: boolean
  /** Color of a remote user who has this frame selected — tints the name to
   *  match their selection rect. Ignored while locally selected. */
  remoteSelectedColor?: string
  /**
   * Where the frame sits and how dragging it moves things. Layers render as
   * flat, absolutely-positioned siblings (not nested in a per-group flex row),
   * so moving one between groups never reparents its React subtree — the
   * iframe DOM survives and there's no reload.
   */
  placement: LayerPlacement
}

function IframeLayerImpl({
  iframeLayer: recordedIframeLayer,
  zoom,
  focused,
  driver = NOBODY_DRIVES,
  askedForControl,
  controlRequests,
  onGrantControl,
  onDeclineControl,
  onControlActivity,
  sharedStream,
  live = false,
  liveDriver = NOBODY_DRIVES,
  onToggleLive,
  liveStarting = false,
  createFlow,
  selected,
  onFocus,
  onToggleCreateFlow: onToggleCreateFlowProp,
  onSelect,
  onResize,
  onResizeStart,
  onResizeEnd,
  onRename,
  onStateChanged,
  onRouteChange,
  onScrollChange,
  writes,
  onColorSchemeChange: onColorSchemeChangeProp,
  onRemove,
  onPlay,
  onOpenInBrowser,
  onDuplicate,
  onAskForKnob: onAskForKnobProp,
  onSetFitToContent,
  onFollowContentHeight,
  onSetSize,
  multiSelected,
  spaceHeld,
  commentMode,
  pickActive,
  dimmed,
  onHover,
  onWheel,
  onDomReady,
  onCaptureReadyChange,
  onCaptureDirty,
  workspace,
  onRestartWorkspace: onRestartWorkspaceProp,
  onOpenLogs: onOpenLogsProp,
  onStartChat: onStartChatProp,
  asking,
  assignableBranches,
  onAssignBranch: onAssignBranchProp,
  discoveredRoutes,
  onSelectRoute: onSelectRouteProp,
  groupLabel,
  showWorkspace,
  groupSelected,
  remoteSelectedColor,
  placement,
}: IframeLayerProps) {
  // A viewer (#1932) loads their own copy of the preview from the viewer
  // origin; the host's frame is the record as it is.
  const { frame: iframeLayer, probe: viewerProbe } =
    useViewerFrame(recordedIframeLayer)
  const viewing = !!useViewing()
  // What only the host does from a frame: pick or start its chat, steer its
  // preview, record a flow, restyle it or ask for a knob (#1933).
  const hostOnly = <T,>(handler: T): T | undefined =>
    viewing ? undefined : handler
  const onToggleCreateFlow = hostOnly(onToggleCreateFlowProp)
  const onColorSchemeChange = hostOnly(onColorSchemeChangeProp)
  const onAskForKnob = hostOnly(onAskForKnobProp)
  const onRestartWorkspace = hostOnly(onRestartWorkspaceProp)
  const onOpenLogs = hostOnly(onOpenLogsProp)
  const onStartChat = hostOnly(onStartChatProp)
  const onSelectRoute = hostOnly(onSelectRouteProp)
  const onAssignBranch = hostOnly(onAssignBranchProp)

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
  // The box the page fills, which the element hit-test measures.
  const bodyRef = useRef<HTMLDivElement>(null)

  // A shared frame (#1392) has no iframe: reloads and routes go to the shared
  // browser over its stream.
  const shared = !!sharedStream
  const sharedFrame = sharedStream?.frame(iframeLayer.id)
  const sharedFrameRef = useRef(sharedFrame)
  useEffect(() => {
    sharedFrameRef.current = sharedFrame
  })

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
  const contentReadyRef = useRef(false)
  useEffect(() => {
    contentReadyRef.current = contentReady
  })

  // Back/forward (issue #795). The preview is cross-origin, so the frame keeps
  // its own list of the routes it has shown and steps its route through it.
  // A page navigation is recorded as it's reported (a replace-style one edits
  // the current entry); any other route change (the route field, another
  // user) is recorded when the route arrives. Back and forward move the index
  // first, so the route they set is already current when it arrives.
  const shownRoute = iframeLayer.route || "/"
  const [history, setHistory] = useState<RouteHistory>(() =>
    createRouteHistory(shownRoute)
  )
  const [lastShownRoute, setLastShownRoute] = useState(shownRoute)
  if (shownRoute !== lastShownRoute) {
    setLastShownRoute(shownRoute)
    setHistory(visitRoute(history, shownRoute))
  }

  // Recording (Create Flow): how many screens this run has laid down, the
  // frame's own screen included. Each new route the frame moves to while
  // recording leaves a screen behind, so each one counts; a replace-style
  // navigation or a history step leaves none.
  const [recordedScreens, setRecordedScreens] = useState(1)
  const [lastCreateFlow, setLastCreateFlow] = useState(createFlow)
  if (createFlow !== lastCreateFlow) {
    setLastCreateFlow(createFlow)
    if (createFlow) setRecordedScreens(1)
  }
  const recordingRef = useRef({ createFlow, shownRoute })
  useEffect(() => {
    recordingRef.current = { createFlow, shownRoute }
  })

  // The route the frame is following client-side (#999), until the page
  // reports it. That report is the echo of a route the room already holds, so
  // it's recorded as a replace, like the first report after a reload, and
  // never counts as a new step.
  const followingRouteRef = useRef<string | null>(null)

  const handleNavigation = useCallback(
    (id: string, path: string, pageReplace: boolean) => {
      let replace = pageReplace
      if (followingRouteRef.current !== null) {
        if (path === followingRouteRef.current) replace = true
        followingRouteRef.current = null
      }
      reportedPathRef.current = path
      setHistory((h) => visitRoute(h, path, replace))
      const recording = recordingRef.current
      if (recording.createFlow && !replace && path !== recording.shownRoute) {
        setRecordedScreens((n) => n + 1)
      }
      onRouteChange?.(id, path, replace)
    },
    [onRouteChange]
  )

  // Where the shared page went, recorded as an iframe records its own
  // navigation (`recordsLiveRoute` says which views write it). Joining
  // reports where the page already is, which is never a new step.
  const driverRef = useRef(driver)
  useEffect(() => {
    driverRef.current = driver
  })
  const handleSharedRoute = useCallback(
    (path: string, first: boolean) => {
      if (!recordsLiveRoute(driverRef.current)) return
      handleNavigation(iframeLayer.id, path, first)
    },
    [handleNavigation, iframeLayer.id]
  )

  const reloadIframe = useCallback(() => {
    const frame = sharedFrameRef.current
    if (frame) {
      frame.reload()
      return
    }
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
      // regardless of the bridge-version housekeeping below. A shared frame
      // is ready when its picture is.
      if (!sharedFrameRef.current) setContentReady(true)
      // Keeping the Workspace's bridge current is the host's job.
      if (!iframeLayer.branchId || viewing) return
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
    [iframeLayer.branchId, reloadIframe, viewing]
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

  const toolbarPortalTarget = useLayerToolbar({
    show: !!iframeLayer.branchId && showToolbar,
    anchorRef: frameRef,
    toolbarRef,
  })
  const showFit = !!onSetFitToContent && !!iframeLayer.branchId
  const fitHeight = showFit && !!iframeLayer.fitHeight
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

  // Both interact mode and Create Flow mode forward pointer events to the
  // iframe and hide the canvas overlay. Create Flow additionally captures
  // navigation events into a history trail (handled in canvas.tsx).
  const interactive = focused || createFlow

  const desiredSrc = iframeLayer.iframeUrl
    ? iframeLayer.iframeUrl + (iframeLayer.route ?? "")
    : undefined

  // The `src` actually applied to the iframe. We avoid changing it when the
  // route update originated from in-iframe navigation (that would reload the
  // iframe back onto the path it's already on).
  const [iframeSrc, setIframeSrc] = useState<string | undefined>(desiredSrc)

  // The page: this viewer's own iframe, or the shared browser's stream.
  const page = useLivePage({
    id: iframeLayer.id,
    source: sharedStream
      ? {
          kind: "stream",
          stream: sharedStream,
          hasPage: !!iframeLayer.iframeUrl,
          route: shownRoute,
          scheme: iframeLayer.colorScheme ?? "light",
          onRoute: handleSharedRoute,
          onLive: setContentReady,
          onActivity: onControlActivity
            ? () => onControlActivity(iframeLayer.id)
            : undefined,
        }
      : { kind: "url", src: iframeSrc },
    record: iframeLayer,
    writes,
    app: {
      onStateChanged,
      onNavigation: handleNavigation,
      onScroll: handleScroll,
      onReady: handleReady,
      onHmrStatus: handleHmrStatus,
    },
    interactive,
    driver,
    zoom,
    width: iframeLayer.width,
    height: iframeLayer.height,
    onWheel,
    onDomReady,
    iframeRef,
    bodyRef,
    onContentHeight: fitHeight ? onFollowContentHeight : undefined,
  })
  const { dom } = page
  const chrome = livePageChrome({
    driver,
    focused,
    live,
    liveDriver,
    onLiveCopy: shared,
  })

  // Fit to content: on, the height snaps to the page's content and then
  // follows it; the width stays where it was set.
  const handleFitToContent = useCallback(
    async (on: boolean) => {
      if (!on) return onSetFitToContent?.(iframeLayer.id, false)
      let height: number | undefined
      try {
        height = (await dom.getDocumentSize())?.height
      } catch {
        // Bridge timeout / iframe not ready: the page reports it once ready.
      }
      onSetFitToContent?.(iframeLayer.id, true, height)
    },
    [dom, iframeLayer.id, onSetFitToContent]
  )

  // The frame's one menu (I7): the toolbar's … and its sidebar row's … both
  // open this. The chat's menu (H4), the same one as its header's …, sits in
  // a Chat submenu so it doesn't read as frame actions.
  const titleEditableRef = useRef<EditableTextHandle>(null)
  const menuActions: LayerMenuActions = {
    noun: "frame",
    onDuplicate,
    moveTo: { kind: "layer", id: iframeLayer.id },
    size: onSetSize
      ? {
          width: iframeLayer.width,
          height: iframeLayer.height,
          onSelect: (w, h) => onSetSize(iframeLayer.id, w, h),
        }
      : undefined,
    fitToContent: showFit
      ? { checked: fitHeight, onCheckedChange: handleFitToContent }
      : undefined,
    chat: {
      branchId: iframeLayer.branchId,
      onPlay: onPlay ? () => onPlay(iframeLayer.id) : undefined,
      onOpenInBrowser,
      onOpenLogs:
        iframeLayer.branchId && onOpenLogs
          ? () => onOpenLogs(iframeLayer.branchId!)
          : undefined,
    },
    onDelete: () => onRemove(iframeLayer.id),
  }
  useRegisterLayerMenu(iframeLayer.id, menuActions)
  const startRename = onRename
    ? () => titleEditableRef.current?.startEditing()
    : undefined

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

  // Bumped per route follow so a late answer for a superseded route is ignored.
  const followSeqRef = useRef(0)

  // This synchronizes the iframe (an external system) with the desired
  // url/route while suppressing reload loops from in-iframe navigation echoes.
  // The decision depends on ref-tracked history (last applied url, last path
  // the iframe reported), which can't be read during render — so it can't move
  // to a render-phase derivation. setState here is the intended sync, not an
  // avoidable cascade.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // A shared frame follows the room's route through its stream.
    if (shared) return
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
      followSeqRef.current++
      followingRouteRef.current = null
      // New page incoming — re-show the overlay until the bridge reports back.
      setContentReady(false)
      setIframeSrc(iframeLayer.iframeUrl + route)
      return
    }
    if (route === reportedPathRef.current) return
    const src = iframeLayer.iframeUrl + route
    const reload = () => {
      followingRouteRef.current = null
      // The applied `src` can already equal the route when the page navigated
      // away from it on its own; setting it again wouldn't reload.
      if (iframeSrcRef.current === src) reloadIframe()
      else {
        setContentReady(false)
        setIframeSrc(src)
      }
    }
    // A loaded page follows the route client-side (another viewer's
    // navigation, the route field, back/forward), so what this viewer typed
    // or opened in it survives (#999). The bridge answers false when the page
    // has no router to take it; only then does the frame reload onto it.
    if (!contentReadyRef.current) {
      reload()
      return
    }
    const token = ++followSeqRef.current
    const path = route || "/"
    followingRouteRef.current = path
    dom.navigate(path).then(
      (followed) => {
        if (!followed && token === followSeqRef.current) reload()
      },
      () => {
        if (token === followSeqRef.current) reload()
      }
    )
  }, [iframeLayer.iframeUrl, iframeLayer.route, dom, reloadIframe, shared])
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
    recordedIframeLayer.iframeUrl && recordedIframeLayer.workspace
      ? {
          ...recordedIframeLayer.workspace,
          url: recordedIframeLayer.iframeUrl,
        }
      : undefined,
    { probe: viewerProbe }
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
    // A shared browser that opened on the placeholder retries on its own.
    if (shared) return
    if (probeState !== "ready" || contentReady) return
    if (recoveryTick >= MAX_PLACEHOLDER_RELOADS) return
    const id = setTimeout(() => {
      reloadIframe()
      setRecoveryTick((n) => n + 1)
    }, PLACEHOLDER_RELOAD_GRACE_MS)
    return () => clearTimeout(id)
  }, [probeState, contentReady, recoveryTick, reloadIframe, shared])

  // The one status screen covering the preview, or null once the live page is
  // up. A branch can be assigned before its dev server is up, so there may be
  // no URL to probe yet; that reads as "starting" rather than a blank frame. A
  // frame whose Workspace was deleted reads as having none.
  const branchId = iframeLayer.branchId
  const stage = resolveFrameStage({
    status: branchId ? workspace?.status : undefined,
    hasPreview: !!desiredSrc,
    probe: probeState,
    contentReady,
    recoveryExhausted: recoveryTick >= MAX_PLACEHOLDER_RELOADS,
  })

  // The toolbar's status dot: the preview's state in one glance, with the
  // status screen in the body carrying the detail.
  const previewStatus: FramePreviewStatus | undefined = !branchId
    ? undefined
    : stage === null
      ? hmrStatus === "disconnected"
        ? "disconnected"
        : "live"
      : stage === "booting" || stage === "starting"
        ? "loading"
        : stage === "stopped"
          ? "stopped"
          : stage === "unassigned"
            ? undefined
            : "failed"

  const navigateHistory = (next: RouteHistory) => {
    if (next === history) return
    setHistory(next)
    onSelectRoute?.(iframeLayer.id, currentRoute(next), true)
  }

  // Retry a dev server that never answered: probe again and give the iframe a
  // fresh recovery budget, starting from a clean reload.
  const retryPreview = useCallback(() => {
    retryProbe()
    setRecoveryTick(0)
    reloadIframe()
  }, [retryProbe, reloadIframe])

  return (
    <LayerShell
      layerId={iframeLayer.id}
      placement={placement}
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
      // Interactive (focus / Create Flow) frames forward pointers to the iframe,
      // so the title bar's drag is detached just like the body overlay is hidden.
      titleDragDisabled={interactive}
      resizable={chrome.resizable}
      titleTag={chrome.titleTag}
      onResize={onResize}
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
      groupLabel={groupLabel}
      renderTitle={(api) => (
        <IframeLayerLabel
          label={iframeLayer.label}
          branchId={iframeLayer.branchId}
          showWorkspace={showWorkspace}
          assignableBranches={assignableBranches}
          onAssignBranch={
            onAssignBranch
              ? (branchId) => onAssignBranch(iframeLayer.id, branchId)
              : undefined
          }
          selected={selected || groupSelected}
          remoteSelectedColor={remoteSelectedColor}
          onSelectFrame={api.deferSelect}
          onRename={
            onRename ? (next) => onRename(iframeLayer.id, next) : undefined
          }
          editableRef={titleEditableRef}
          // With no Workspace there's no toolbar, so the menu sits on the
          // label as a document's does.
          menu={
            selected && !multiSelected && !iframeLayer.branchId
              ? menuActions
              : undefined
          }
        />
      )}
    >
      {(api) => (
        <>
          {toolbarPortalTarget &&
            createPortal(
              <FloatingToolbar
                ref={toolbarRef}
                aria-label="Frame"
                // Positioned every frame by the rAF loop above (translate is set
                // imperatively from the frame's getBoundingClientRect). Lives
                // outside the world transform, so it's already at constant screen
                // size — no inverse-zoom scaling needed.
                className="absolute top-0 left-0"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <FloatingToolbarButton
                  label="Back"
                  disabled={!onSelectRoute || !canGoBack(history)}
                  onClick={() => navigateHistory(goBack(history))}
                >
                  <ArrowLeftIcon />
                </FloatingToolbarButton>
                <FloatingToolbarButton
                  label="Forward"
                  disabled={!onSelectRoute || !canGoForward(history)}
                  onClick={() => navigateHistory(goForward(history))}
                >
                  <ArrowRightIcon />
                </FloatingToolbarButton>
                <FrameAddressBar
                  route={iframeLayer.route}
                  discoveredRoutes={discoveredRoutes ?? []}
                  onSelectRoute={
                    onSelectRoute
                      ? (route) => {
                          if (createFlow && route !== shownRoute) {
                            setRecordedScreens((n) => n + 1)
                          }
                          onSelectRoute(iframeLayer.id, route)
                        }
                      : undefined
                  }
                  sharedState={iframeLayer.sharedState}
                  status={previewStatus}
                  onReload={reloadIframe}
                  recording={createFlow}
                  recordedScreens={recordedScreens}
                  onToggleRecording={
                    onToggleCreateFlow &&
                    (() =>
                      onToggleCreateFlow(createFlow ? null : iframeLayer.id))
                  }
                />
                <FloatingToolbarSeparator />
                <LivePageControls
                  page={page}
                  focused={focused}
                  onFocus={onFocus}
                  askedForControl={askedForControl}
                  controlRequests={controlRequests}
                  onGrantControl={onGrantControl}
                  onDeclineControl={onDeclineControl}
                  live={live}
                  onToggleLive={onToggleLive}
                  liveStarting={liveStarting}
                  onAskForKnob={onAskForKnob}
                  theme={
                    shared && onColorSchemeChange
                      ? {
                          value: iframeLayer.colorScheme ?? "light",
                          onChange: (scheme) =>
                            onColorSchemeChange(iframeLayer.id, scheme),
                        }
                      : undefined
                  }
                />
                <LayerMenu
                  placement="toolbar"
                  actions={menuActions}
                  onRename={startRename}
                />
              </FloatingToolbar>,
              toolbarPortalTarget
            )}
          <div
            ref={bodyRef}
            className="relative h-full w-full overflow-hidden bg-white dark:bg-neutral-900"
          >
            {/* The iframe mounts as soon as there's a URL — not gated on the
            probe. The probe is a server-action round-trip; gating the mount on
            it meant the browser only started fetching the page *after* the probe
            had already fetched it once, serializing two full loads. Now the
            iframe loads in parallel with the probe and the status screen below
            just hides it until the dev server is confirmed reachable. */}
            <LivePageContent page={page} iframeRef={iframeRef} />
            <LivePageOverlay
              page={page}
              api={api}
              hasPage={!!iframeLayer.branchId}
              commentMode={commentMode}
              pickActive={pickActive}
              dimmed={dimmed}
              spaceHeld={spaceHeld}
              onHover={onHover}
              onSelect={onSelect}
              onFocus={onFocus}
            />

            {/* The status screen covering the still-loading (or placeholder)
            iframe. It drops the instant the iframe's bridge reports the real
            page is up (`contentReady`) — a postMessage, no server round-trip —
            so the warm path doesn't sit on it waiting for the probe RPC to
            return. It stays up while recovery is still reloading, so the
            proxy's bare "Dev server not yet ready" placeholder and the
            about:blank between reload cycles never flash through; once recovery
            is exhausted it turns into the failed state rather than dropping to
            a blank frame. It sits above the drag overlay but is
            pointer-transparent apart from its buttons, so the frame still drags
            and selects through it. */}
            {stage && (
              <FrameStatus
                stage={stage}
                zoom={zoom}
                frameWidth={iframeLayer.width}
                frameHeight={iframeLayer.height}
                detail={
                  stage === "workspace-failed"
                    ? workspace?.error
                    : stage === "unassigned"
                      ? // The Group's label offers the list instead (#871).
                        onStartChat
                        ? showWorkspace
                          ? START_A_CHAT
                          : START_A_CHAT_IN_GROUP
                        : showWorkspace
                          ? undefined
                          : UNASSIGNED_IN_GROUP
                      : workspace?.statusMessage
                }
                onRetry={
                  stage === "preview-failed"
                    ? retryPreview
                    : branchId && onRestartWorkspace
                      ? () => onRestartWorkspace(branchId)
                      : undefined
                }
                onStart={
                  branchId && onRestartWorkspace
                    ? () => onRestartWorkspace(branchId)
                    : undefined
                }
                onOpenLogs={
                  branchId && onOpenLogs
                    ? () => onOpenLogs(branchId)
                    : undefined
                }
                onStartChat={
                  onStartChat ? () => onStartChat(iframeLayer.id) : undefined
                }
              />
            )}

            {/* The chat prompt is open on this frame: the dialog overlay's
            tint and blur over the whole frame, so the card reads on its own.
            The blur is counter-scaled to stay 4px on screen. */}
            {asking && (
              <div
                aria-hidden
                data-slot="ask-scrim"
                className="pointer-events-none absolute inset-0 bg-black/10"
                style={{ backdropFilter: `blur(${4 / (zoom || 1)}px)` }}
              />
            )}
          </div>
        </>
      )}
    </LayerShell>
  )
}

/**
 * Memoized: the canvas re-renders its member list on every pointer move of a
 * drag, marquee or draw, and `CanvasMemberLayer` keeps each frame's props
 * identical unless they change, so only the frames that changed render.
 */
export const IframeLayer = memo(IframeLayerImpl)
