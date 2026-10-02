"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsOutSimpleIcon,
  CopyIcon,
  DotsThreeIcon,
  GitBranchIcon,
  PlayIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarSeparator,
} from "@workspace/ui/components/floating-toolbar"
import { resolveFrameStage } from "@/components/frame-status/frame-stage"
import { FrameStatus } from "@/components/frame-status/frame-status"
import { useDevServerProbe } from "@/hooks/use-dev-server-probe"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import {
  useScreenplayDom,
  type ScreenplayDom,
  type WheelForward,
} from "@/hooks/use-screenplay-dom"
import { canInteractOnDoubleClick } from "@/lib/canvas/interaction-mode"
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
import { OpenInBrowserItem } from "../open-in-browser-item"
import { DeviceSizeSubMenu } from "./device-size-menu"
import {
  FrameAddressBar,
  frameWorkspaceOf,
  type FramePreviewStatus,
} from "./frame-nav"
import type { GroupWorkspace } from "./group-label"
import { IframeLayerLabel } from "./iframe-layer-label"
import { KnobsPopover } from "./knobs-popover"
import { FrameDriverButton, FrameDriverTag } from "./frame-driver"
import type { FrameDriverView } from "./use-frame-control"
import { drivenByOther } from "@/lib/canvas/frame-control"
import { useLayerToolbar } from "./use-layer-toolbar"
import { LayerShell, LAYER_SURFACE_CLASS } from "./layer-shell"
import type { BranchData } from "@/lib/types"
import type {
  DomRect,
  HmrStatus,
  JsonObject,
  JsonValue,
} from "@/lib/postmessage-protocol"

const UNASSIGNED_IN_GROUP =
  "Choose a Workspace from the group's title to preview it here."
/** The unanswered frame's copy when it can start a chat (#1358). */
const START_A_CHAT =
  "Start a chat to build something here, or choose a Workspace from the frame's title."
const START_A_CHAT_IN_GROUP =
  "Start a chat to build something here, or choose a Workspace from the group's title."

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
  knobs?: JsonValue[]
  knobValues?: JsonObject
  sharedState?: JsonObject
}

const NOBODY_DRIVES: FrameDriverView = { kind: "none" }

interface IframeLayerProps {
  iframeLayer: IframeLayerData
  zoom: number
  /** The Canvas hides this Layer's label (see `hiddenLayerLabels`). */
  labelHidden?: boolean
  focused: boolean
  /** Who drives the frame (#1387). Someone else driving it shows their mark on
   *  Interact, the title-line tag, and no resize handles. */
  driver?: FrameDriverView
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
  /** Append a copy of this frame to its group (the frame menu's Duplicate). */
  onDuplicate?: () => void
  /** Start an "add a knob" request in this frame's Workspace chat. */
  onAskForKnob?: () => void
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
  /** Group label shown above the branch — only on the leftmost iframeLayer of a multi-iframeLayer group. */
  groupLabel?: string
  /** The Group's Workspace, named after the group label (#868). */
  groupWorkspace?: GroupWorkspace
  /** The frame names its own Workspace on its label: its Group's frames
   *  differ, or it is a Group of one with no group label (#1276). */
  showWorkspace?: boolean
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
  labelHidden,
  focused,
  driver = NOBODY_DRIVES,
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
  onRemove,
  onPlay,
  onOpenInBrowser,
  onDuplicate,
  onAskForKnob,
  onFitToContent,
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
  onRestartWorkspace,
  onOpenLogs,
  onStartChat,
  assignableBranches,
  onAssignBranch,
  discoveredRoutes,
  onSelectRoute,
  groupLabel,
  groupWorkspace,
  showWorkspace,
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

  const toolbarPortalTarget = useLayerToolbar({
    show: !!iframeLayer.branchId && showToolbar,
    anchorRef: frameRef,
    toolbarRef,
  })
  const showFit = !!onFitToContent && !!iframeLayer.branchId
  const showPlay = !!onPlay
  // Open the frame's live preview in a real browser tab, deep-linked to the
  // route it's currently showing — the same page the iframe loads, minus the
  // prototype-player wrapper. The canvas binds `onOpenInBrowser` only when the
  // frame has a live preview (and a Branch/Repo to resolve the portless URL),
  // so its presence is the gate.
  const showOpenInBrowser = !!onOpenInBrowser
  // The `…` menu holds this frame's own actions (device size, fit,
  // duplicate, delete); Workspace-scoped actions (prototype player, open in
  // browser) sit in its Workspace submenu so they don't read as frame actions.
  const showWorkspaceMenu = showPlay || showOpenInBrowser

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

  // Both interact mode and Create Flow mode forward pointer events to the
  // iframe and hide the canvas overlay. Create Flow additionally captures
  // navigation events into a history trail (handled in canvas.tsx).
  const interactive = focused || createFlow

  const dom = useScreenplayDom(iframeRef, {
    onWheel: (wheel) => onWheel?.(iframeLayer.id, wheel),
    // Esc the page didn't claim, forwarded by the bridge because keydowns
    // never leave the iframe. Replay it on the canvas's own window so it
    // walks the same Escape precedence (lib/canvas/escape.ts) as an Esc
    // pressed on the canvas: an armed pick cancels first, otherwise the frame
    // leaves interaction.
    // Space pressed in the page with the pointer out over the canvas, so
    // space-drag pans the canvas as it does outside Interact.
    onSpaceDown: () => {
      if (!interactive) return
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
    },
    onSpaceUp: () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }))
    },
    onEscape: () => {
      if (!interactive) return
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    },
  })

  // Leaving interaction (Esc, the toolbar, or a deselect) hands keyboard focus
  // back to the canvas. Otherwise it stays inside the iframe, and canvas
  // shortcuts, a second Esc included, go to the preview instead.
  useEffect(() => {
    if (interactive) {
      // Entering from the toolbar leaves focus on the Interact button, where
      // Space would press it (leaving Interact) instead of panning the canvas.
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active.closest("#frame-toolbar-portal")
      )
        active.blur()
      return
    }
    const iframe = iframeRef.current
    if (iframe && document.activeElement === iframe) iframe.blur()
  }, [interactive])

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
  }, [iframeLayer.iframeUrl, iframeLayer.route, dom, reloadIframe])
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
      labelHidden={labelHidden}
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
      // No resize handles while interacting: the Selection Overlay hides its
      // drawn ones, and the edge hit areas would steal clicks from the page.
      // Nor while someone else drives, so the size never changes under them.
      resizable={!focused && !drivenByOther(driver)}
      titleTag={
        drivenByOther(driver) ? <FrameDriverTag driver={driver} /> : undefined
      }
      onResize={onResize}
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
      groupLabel={groupLabel}
      groupWorkspace={groupWorkspace}
      remoteGroupSelectedColor={remoteGroupSelectedColor}
      onSelectGroup={onSelectGroup}
      onRenameGroup={onRenameGroup}
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
                  workspace={frameWorkspaceOf(
                    assignableBranches?.find(
                      (a) => a.id === iframeLayer.branchId
                    )
                  )}
                  workspaces={assignableBranches ?? []}
                  onAssignWorkspace={
                    onAssignBranch
                      ? (branchId) => onAssignBranch(iframeLayer.id, branchId)
                      : undefined
                  }
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
                  onToggleRecording={() =>
                    onToggleCreateFlow(createFlow ? null : iframeLayer.id)
                  }
                />
                <FloatingToolbarSeparator />
                <FrameDriverButton
                  driver={driver}
                  onClick={() => onFocus(focused ? null : iframeLayer.id)}
                />
                <KnobsPopover
                  knobs={iframeLayer.knobs}
                  values={iframeLayer.knobValues}
                  onChange={(values) =>
                    onKnobValuesChange?.(iframeLayer.id, values)
                  }
                  onAskForKnob={onAskForKnob}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <FloatingToolbarButton label="More">
                      <DotsThreeIcon className="text-muted-foreground" />
                    </FloatingToolbarButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="bottom"
                    align="end"
                    sideOffset={8}
                    className="min-w-44"
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
                        <ArrowsOutSimpleIcon />
                        Fit to content
                      </DropdownMenuItem>
                    )}
                    {onDuplicate && (
                      <DropdownMenuItem onSelect={onDuplicate}>
                        <CopyIcon />
                        Duplicate
                      </DropdownMenuItem>
                    )}
                    {showWorkspaceMenu && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <GitBranchIcon />
                            Workspace
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {showPlay && (
                              <DropdownMenuItem
                                onSelect={() => onPlay?.(iframeLayer.id)}
                              >
                                <PlayIcon />
                                Open prototype player
                              </DropdownMenuItem>
                            )}
                            {onOpenInBrowser && (
                              <OpenInBrowserItem onOpen={onOpenInBrowser} />
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onRemove(iframeLayer.id)}
                    >
                      <TrashIcon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </FloatingToolbar>,
              toolbarPortalTarget
            )}
          <div
            className={`relative h-full w-full overflow-hidden bg-white dark:bg-neutral-900 ${LAYER_SURFACE_CLASS}`}
          >
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
                className="absolute inset-0 h-full w-full border-0 bg-white dark:bg-neutral-900"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                style={{ pointerEvents: interactive ? "auto" : "none" }}
              />
            )}
            {/* Dim scrim for an armed pick on another branch (#619): a subtle
            wash over the frame body so the eligible (undimmed) frames stand out.
            Pointer-transparent — a click still falls through to the canvas-level
            target handler, which treats a non-eligible frame as a cancel. */}
            {dimmed && (
              <div className="pointer-events-none absolute inset-0 z-10 bg-background/60 transition-opacity" />
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
                {...((commentMode || pickActive) && !spaceHeld && !dimmed
                  ? {
                      // Hover-only: show the inspect overlay so the user can see
                      // what element they're about to comment on / target. The
                      // click is handled by the canvas-level handler (comment or
                      // pick), which re-runs elementAtPoint to capture the
                      // selector. Dimmed (pick-ineligible) frames don't track.
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
                onDoubleClick={(e) => {
                  if (
                    !canInteractOnDoubleClick({
                      hasPreview: !!iframeLayer.branchId,
                      commentMode: !!commentMode,
                      // A dimmed frame is ineligible for an armed pick, but
                      // the pick still owns the pointer.
                      pickActive: !!pickActive || !!dimmed,
                      spaceHeld,
                    })
                  )
                    return
                  e.stopPropagation()
                  // Interaction lives only while its frame is selected, so a
                  // double-click on a member of a selected group narrows the
                  // selection to this frame first.
                  onSelect(iframeLayer.id, false)
                  onFocus(iframeLayer.id)
                }}
              />
            )}

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
          </div>
        </>
      )}
    </LayerShell>
  )
}
