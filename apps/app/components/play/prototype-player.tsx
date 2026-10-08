"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type PanelImperativeHandle } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import {
  isScreenplayMessage,
  type JsonObject,
  type JsonValue,
} from "@/lib/postmessage-protocol"
import type { ThreadWithComments } from "@/lib/comments"
import {
  DEFAULT_IFRAME_LAYER_SIZE_ID,
  getIframeLayerSizePreset,
} from "@/lib/iframe-layer-sizes"
import {
  useBranches,
  useCollectionEntry,
  useRoomCollections,
} from "@/lib/yjs/react"
import type { IframeLayerData } from "@/lib/types"
import { resolveFrameStage } from "@/components/frame-status/frame-stage"
import { FrameStatus } from "@/components/frame-status/frame-status"
import { useDevServerProbe } from "@/hooks/use-dev-server-probe"
import { useStartWorkspace } from "@/hooks/use-start-workspace"
import { keyTargetOf } from "@/lib/canvas/key-target"
import { matchCanvasKey } from "@/lib/canvas/shortcuts"
import { commenting } from "@/lib/capabilities"
import { PlayerHud } from "./player-hud"
import { PlayerChatHost } from "./player-chat-host"
import { PlayerCommentLayer, usePlayerComments } from "./player-comments"

interface PrototypePlayerProps {
  roomId: string
  roomName: string
  agentId: string
  branch: string
  previewDomain: string
  /** The Workspace's Sandbox and Dev Server Port, which the preview probe asks about. */
  sandboxName: string
  devPort: number
  initialRoute: string
  initialKnobValues: Record<string, unknown>
  initialSharedState: Record<string, unknown>
  /** When the player was opened from a specific iframeLayer, route shared-state
   *  through that iframeLayer's Yjs entry so canvas + player + other player tabs
   *  all converge on the same snapshot. */
  iframeLayerId?: string
  initialThreads: ThreadWithComments[] | undefined
  /** Repo's default iframeLayer size id — seeds mobile/tablet preview if it's a non-desktop preset. */
  initialDeviceSizeId?: string
}

const DEVICE_PADDING = 48
// Placeholder recovery, as on the canvas frame (`iframe-layer.tsx`): once the
// probe reports the dev server up but no real page has painted, the iframe is
// sitting on the proxy placeholder it loaded too early, so reload it.
const PLACEHOLDER_RELOAD_GRACE_MS = 1500
const MAX_PLACEHOLDER_RELOADS = 10
const STORAGE_KEY_DEVICE = "screenplay:player-device-size"

export function PrototypePlayer({
  roomId,
  roomName,
  agentId,
  branch,
  previewDomain,
  sandboxName,
  devPort,
  initialRoute,
  initialKnobValues,
  initialSharedState,
  iframeLayerId,
  initialThreads,
  initialDeviceSizeId,
}: PrototypePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [knobs, setKnobs] = useState<JsonValue[]>([])
  const [knobValues, setKnobValues] = useState<JsonObject>(
    initialKnobValues as JsonObject
  )

  // Live shared state from Yjs when we have an iframeLayer binding. Falls back
  // to the SSR-hydrated snapshot otherwise (single-player mode — the iframe
  // still publishes via postMessage but state doesn't survive a reload).
  const collections = useRoomCollections()
  const liveIframeLayer = useCollectionEntry<IframeLayerData>(
    collections.iframeLayers,
    iframeLayerId ?? ""
  )
  const sharedState = useMemo<JsonObject>(() => {
    if (iframeLayerId && liveIframeLayer?.sharedState) {
      return liveIframeLayer.sharedState as JsonObject
    }
    return initialSharedState as JsonObject
  }, [iframeLayerId, liveIframeLayer, initialSharedState])
  const sharedStateRef = useRef(sharedState)
  useEffect(() => {
    sharedStateRef.current = sharedState
  }, [sharedState])
  // Last serialized snapshot we sent down to the iframe — used to suppress
  // redundant applies when our own publish loops back through Yjs.
  const lastAppliedSharedRef = useRef<string | null>(null)
  // While the HUD is being dragged the iframe must not capture pointer events
  // — pointer capture doesn't cross cross-origin iframe boundaries, so a fast
  // drag would otherwise escape onto the iframe's document and the drag would
  // drop. We flip pointer-events:none on the iframe for the duration.
  const [hudDragging, setHudDragging] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(true)
  const chatPanelRef = useRef<PanelImperativeHandle>(null)
  const knobValuesRef = useRef(knobValues)
  useEffect(() => {
    knobValuesRef.current = knobValues
  }, [knobValues])

  // Device preview state. Initial value prefers a previously-saved choice for
  // this session, then the repo default, then desktop full-bleed.
  const [deviceSizeId, setDeviceSizeId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(STORAGE_KEY_DEVICE)
      if (saved) return saved
    }
    return initialDeviceSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  })
  const handleDeviceSizeChange = useCallback((id: string) => {
    setDeviceSizeId(id)
    try {
      window.localStorage.setItem(STORAGE_KEY_DEVICE, id)
    } catch {}
  }, [])
  const devicePreset = getIframeLayerSizePreset(deviceSizeId)
  const isDesktop = devicePreset.category === "Desktop"
  const isTouchDevice =
    devicePreset.category === "Mobile" || devicePreset.category === "Tablet"

  // Auto-fit scale: shrink the device when the canvas can't accommodate it at
  // 1×. We never scale up — desktop sub-viewport sizes letterbox instead.
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(
    null
  )
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fitScale = useMemo(() => {
    if (isDesktop) return 1
    if (!stageSize) return 1
    const availW = Math.max(0, stageSize.w - DEVICE_PADDING * 2)
    const availH = Math.max(0, stageSize.h - DEVICE_PADDING * 2)
    if (availW <= 0 || availH <= 0) return 1
    return Math.min(
      1,
      availW / devicePreset.width,
      availH / devicePreset.height
    )
  }, [devicePreset, isDesktop, stageSize])

  // The live Workspace, so the player follows it from booting to ready (or to
  // failed / stopped) instead of loading whatever the page rendered with.
  const branches = useBranches()
  const workspace = branches.find((b) => b.id === agentId)
  const livePreviewDomain = workspace ? workspace.previewDomain : previewDomain

  // No preview URL yet (a Workspace still booting) means no iframe at all: an
  // empty `src` would load the player's own origin into the frame.
  const initialPath = initialRoute || "/"
  const initialSrc = livePreviewDomain
    ? livePreviewDomain.replace(/\/$/, "") +
      (initialPath.startsWith("/") ? initialPath : `/${initialPath}`)
    : undefined

  const { state: probeState, retry: retryProbe } = useDevServerProbe(
    livePreviewDomain
      ? {
          sandboxName: workspace?.sandboxName ?? sandboxName,
          devPort: workspace?.port ?? devPort,
          url: livePreviewDomain,
        }
      : undefined
  )
  // The bridge's `screenplay:ready`: a real page painted, not the placeholder.
  const [contentReady, setContentReady] = useState(false)
  const [reloads, setReloads] = useState(0)
  // A new preview URL is a fresh load with its own recovery budget.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setContentReady(false)
    setReloads(0)
  }, [initialSrc])
  /* eslint-enable react-hooks/set-state-in-effect */

  const reloadIframe = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || !initialSrc) return
    setContentReady(false)
    iframe.src = "about:blank"
    requestAnimationFrame(() => {
      if (iframeRef.current) iframeRef.current.src = initialSrc
    })
  }, [initialSrc, setContentReady])

  useEffect(() => {
    if (probeState !== "ready" || contentReady) return
    if (reloads >= MAX_PLACEHOLDER_RELOADS) return
    const id = setTimeout(() => {
      reloadIframe()
      setReloads((n) => n + 1)
    }, PLACEHOLDER_RELOAD_GRACE_MS)
    return () => clearTimeout(id)
  }, [probeState, contentReady, reloads, reloadIframe])

  const stage = resolveFrameStage({
    // The player is always opened on a Workspace; one deleted since reads as
    // running, and its dead preview then fails the probe.
    status: workspace?.status ?? "running",
    hasPreview: !!initialSrc,
    probe: probeState,
    contentReady,
    recoveryExhausted: reloads >= MAX_PLACEHOLDER_RELOADS,
  })

  const retryPreview = useCallback(() => {
    retryProbe()
    setReloads(0)
    reloadIframe()
  }, [retryProbe, reloadIframe, setReloads])

  // Going to a comment on another route: the page loads there, and its pin
  // shows once the page reports that route.
  const navigate = useCallback(
    (route: string) => {
      const iframe = iframeRef.current
      if (!iframe || !livePreviewDomain) return
      iframe.src =
        livePreviewDomain.replace(/\/$/, "") +
        (route.startsWith("/") ? route : `/${route}`)
    },
    [livePreviewDomain]
  )
  // The route the page reports it's on, for placing and listing comments.
  const [currentRoute, setCurrentRoute] = useState(initialPath)
  const describeWorkspace = useCallback(
    () => ({ title: branch, route: currentRoute }),
    [branch, currentRoute]
  )
  const viewport = useMemo(
    () =>
      isDesktop
        ? stageSize && { width: stageSize.w, height: stageSize.h }
        : { width: devicePreset.width, height: devicePreset.height },
    [isDesktop, stageSize, devicePreset]
  )
  const comments = usePlayerComments({
    roomId,
    agentId,
    iframeLayerId,
    initialThreads,
    iframeRef,
    viewport,
    scale: fitScale,
    route: currentRoute,
    describeWorkspace,
    onNavigate: navigate,
  })

  const startWorkspace = useStartWorkspace()
  const restartWorkspace = useCallback(
    () => startWorkspace(agentId),
    [startWorkspace, agentId]
  )

  const sendKnobValues = useCallback((values: JsonObject) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:knob-values", values },
      "*"
    )
  }, [])

  // The bridge owns the touch puck — we just tell it which mode to be in.
  // Sent on every ready handshake (so a reload picks the right mode) and on
  // every category change while a session is open.
  const sendCursorMode = useCallback((touch: boolean) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:cursor-mode", mode: touch ? "touch" : "default" },
      "*"
    )
  }, [])
  const isTouchDeviceRef = useRef(isTouchDevice)
  useEffect(() => {
    isTouchDeviceRef.current = isTouchDevice
    sendCursorMode(isTouchDevice)
  }, [isTouchDevice, sendCursorMode])

  const sendSharedState = useCallback((state: JsonObject, initial = false) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:shared-state-apply", state, initial },
      "*"
    )
  }, [])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!isScreenplayMessage(e.data)) return
      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      if (e.data.type === "screenplay:ready") {
        setContentReady(true)
        // The bridge expects an init state; the player has none, but sending
        // an empty state lets the bridge complete its handshake.
        iframe.contentWindow.postMessage(
          { type: "screenplay:init", state: {} },
          "*"
        )
        // Resend the current cursor mode — a navigation or reload re-injects
        // the bridge with default state, so the puck would otherwise reset.
        sendCursorMode(isTouchDeviceRef.current)
      } else if (e.data.type === "screenplay:navigation") {
        setCurrentRoute(e.data.path)
      } else if (e.data.type === "screenplay:knobs-declared") {
        setKnobs(e.data.knobs)
        // Iframe just (re)registered; push our values down so the prototype
        // reflects whatever the user already set in the canvas / URL params.
        if (Object.keys(knobValuesRef.current).length > 0) {
          sendKnobValues(knobValuesRef.current)
        }
        // The iframe just (re)mounted — it may have fresh local state that's
        // about to publish, but in case other clients have already written
        // to Yjs we mirror that down too. The runtime diffs incoming values
        // so this is safe to send unconditionally.
        if (
          sharedStateRef.current &&
          Object.keys(sharedStateRef.current).length > 0
        ) {
          const serialized = JSON.stringify(sharedStateRef.current)
          lastAppliedSharedRef.current = serialized
          sendSharedState(sharedStateRef.current)
        }
      } else if (e.data.type === "screenplay:shared-state-request") {
        // The frame just loaded and holds its publish until the room answers,
        // so its defaults never overwrite state other viewers already set.
        const state = sharedStateRef.current ?? {}
        try {
          lastAppliedSharedRef.current = JSON.stringify(state)
        } catch {
          lastAppliedSharedRef.current = null
        }
        sendSharedState(state, true)
      } else if (e.data.type === "screenplay:shared-state") {
        const next = e.data.state
        // Persist to Yjs when we have an iframeLayer binding so other clients
        // (canvas + sibling player tabs) catch up. Without an iframeLayer the
        // player still works locally — the iframe owns its in-memory state.
        if (iframeLayerId) {
          let serialized: string | null = null
          try {
            serialized = JSON.stringify(next)
          } catch {
            serialized = null
          }
          // Mark as the last value we'd echo so the upcoming Yjs change
          // doesn't bounce back into the iframe.
          lastAppliedSharedRef.current = serialized
          collections.iframeLayers.update(iframeLayerId, { sharedState: next })
        } else {
          // No persistence path — keep a local copy so the HUD/dev tools
          // could surface it later without round-tripping through Yjs.
          sharedStateRef.current = next
        }
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [
    sendKnobValues,
    sendCursorMode,
    sendSharedState,
    iframeLayerId,
    collections,
  ])

  const handleKnobChange = useCallback(
    (next: JsonObject) => {
      setKnobValues(next)
      sendKnobValues(next)
    },
    [sendKnobValues]
  )

  // Push remote shared-state changes from Yjs down into our iframe. Skip the
  // echo when the change matches the last value we just published from this
  // tab — the iframe's runtime would diff and ignore it anyway, but staying
  // off the wire keeps things tidy.
  useEffect(() => {
    if (!iframeLayerId) return
    let serialized: string
    try {
      serialized = JSON.stringify(sharedState)
    } catch {
      return
    }
    if (serialized === lastAppliedSharedRef.current) return
    lastAppliedSharedRef.current = serialized
    sendSharedState(sharedState)
  }, [iframeLayerId, sharedState, sendSharedState])

  // "Open logs" on a failed Workspace: open the chat panel on its logs tab.
  const [logsRequest, setLogsRequest] = useState<{
    agentId: string
    nonce: number
  } | null>(null)
  const handleOpenLogs = useCallback(() => {
    chatPanelRef.current?.expand()
    setLogsRequest((prev) => ({ agentId, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [agentId])

  const handleToggleChat = useCallback(() => {
    const panel = chatPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

  // ⌘I / Ctrl+I opens and hides the chat, as on the canvas and as the chat's
  // Collapse button says: the canvas's own matcher decides, so it works from
  // the composer but not from other text or inside a menu or dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const action = matchCanvasKey(e, keyTargetOf(e.target), {
        comments: false,
      })
      if (action !== "toggle-chat") return
      e.preventDefault()
      handleToggleChat()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleToggleChat])

  // Stable so the memoized PlayerChatHost isn't re-rendered by the per-frame
  // `stageSize` updates during a panel resize (see PlayerChatHost's memo note).
  const handleCollapseChat = useCallback(() => {
    chatPanelRef.current?.collapse()
  }, [])

  const iframeStyle: React.CSSProperties = {
    pointerEvents: hudDragging ? "none" : "auto",
  }

  const iframe = initialSrc ? (
    <iframe
      ref={iframeRef}
      src={initialSrc}
      title={`${roomName} — ${branch}`}
      className="h-full w-full border-0 bg-white dark:bg-neutral-900"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      style={iframeStyle}
    />
  ) : null
  // The same status screen a canvas frame shows, so the player never sits on a
  // blank white frame or the proxy's bare placeholder.
  const statusScreen = stage ? (
    <FrameStatus
      stage={stage}
      detail={
        stage === "workspace-failed"
          ? workspace?.error
          : workspace?.statusMessage
      }
      onRetry={stage === "preview-failed" ? retryPreview : restartWorkspace}
      onStart={restartWorkspace}
      onOpenLogs={handleOpenLogs}
      // Opaque to the pointer too: nothing behind it is worth clicking.
      className="pointer-events-auto"
    />
  ) : null

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="fixed inset-0 bg-black"
    >
      <ResizablePanel id="player-canvas" minSize="200px">
        <div className="relative h-full w-full">
          <div
            ref={stageRef}
            className="absolute inset-0 flex items-center justify-center overflow-hidden"
          >
            {/* One iframe for every device size: switching resizes this
             *  wrapper instead of swapping elements, so the prototype keeps its
             *  route and in-memory state. */}
            <div
              className={
                isDesktop
                  ? "relative h-full w-full"
                  : "relative shrink-0 overflow-hidden bg-white shadow-2xl ring-1 ring-white/10 dark:bg-neutral-900"
              }
              style={
                isDesktop
                  ? undefined
                  : {
                      width: devicePreset.width,
                      height: devicePreset.height,
                      transform: `scale(${fitScale})`,
                      transformOrigin: "center center",
                      borderRadius: devicePreset.cornerRadius,
                    }
              }
            >
              {iframe}
              {commenting && iframe && !stage && (
                <PlayerCommentLayer {...comments.layer} />
              )}
              {statusScreen}
            </div>
          </div>
          <PlayerHud
            roomId={roomId}
            roomName={roomName}
            knobs={knobs}
            knobValues={knobValues}
            onKnobChange={handleKnobChange}
            onDraggingChange={setHudDragging}
            onToggleChat={handleToggleChat}
            chatOpen={!chatCollapsed}
            comments={comments}
            deviceSizeId={deviceSizeId}
            onDeviceSizeChange={handleDeviceSizeChange}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle
        className={`${chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"} ${isTouchDevice ? "dark" : ""}`}
        disabled={chatCollapsed}
      />
      <ResizablePanel
        id="player-chat"
        defaultSize="0px"
        minSize="360px"
        collapsible
        collapsedSize="0px"
        groupResizeBehavior="preserve-pixel-size"
        panelRef={chatPanelRef}
        onResize={(size) => setChatCollapsed(size.inPixels === 0)}
      >
        {/* Force dark mode when the device preview is showing a phone/tablet
         *  frame — the surrounding bezel is black, so a light sidebar reads as
         *  jarringly bright next to it. text-foreground re-resolves the
         *  inherited text color against the dark token set; without it,
         *  `color` stays the value computed at <body>. */}
        <div
          className={isTouchDevice ? "dark h-full text-foreground" : "h-full"}
        >
          <PlayerChatHost
            roomId={roomId}
            agentId={agentId}
            onCollapse={handleCollapseChat}
            logsRequest={logsRequest}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
