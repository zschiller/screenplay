"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import { useCollectionEntry, useRoomCollections } from "@/lib/yjs/react"
import type { IframeLayerData } from "@/lib/types"
import { PlayerHud } from "./player-hud"
import { PlayerChatHost } from "./player-chat-host"

interface PrototypePlayerProps {
  roomId: string
  roomName: string
  agentId: string
  branch: string
  previewDomain: string
  initialRoute: string
  initialKnobValues: Record<string, unknown>
  initialSharedState: Record<string, unknown>
  /** When the player was opened from a specific iframeLayer, route shared-state
   *  through that iframeLayer's Yjs entry so canvas + player + other player tabs
   *  all converge on the same snapshot. */
  iframeLayerId?: string
  initialThreads: ThreadWithComments[]
  /** Repo's default iframeLayer size id — seeds mobile/tablet preview if it's a non-desktop preset. */
  initialDeviceSizeId?: string
}

const DEVICE_PADDING = 48
const STORAGE_KEY_DEVICE = "screenplay:player-device-size"

export function PrototypePlayer({
  roomId,
  roomName,
  agentId,
  branch,
  previewDomain,
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
    initialKnobValues as JsonObject,
  )

  // Live shared state from Yjs when we have an iframeLayer binding. Falls back
  // to the SSR-hydrated snapshot otherwise (single-player mode — the iframe
  // still publishes via postMessage but state doesn't survive a reload).
  const collections = useRoomCollections()
  const liveIframeLayer = useCollectionEntry<IframeLayerData>(
    collections.iframeLayers,
    iframeLayerId ?? "",
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
  const isTouchDevice =
    devicePreset.category === "Mobile" || devicePreset.category === "Tablet"

  // Auto-fit scale: shrink the device when the canvas can't accommodate it at
  // 1×. We never scale up — desktop sub-viewport sizes letterbox instead.
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(
    null,
  )
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () =>
      setStageSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fitScale = useMemo(() => {
    if (devicePreset.category === "Desktop") return 1
    if (!stageSize) return 1
    const availW = Math.max(0, stageSize.w - DEVICE_PADDING * 2)
    const availH = Math.max(0, stageSize.h - DEVICE_PADDING * 2)
    if (availW <= 0 || availH <= 0) return 1
    return Math.min(
      1,
      availW / devicePreset.width,
      availH / devicePreset.height,
    )
  }, [devicePreset, stageSize])

  const initialSrc = useMemo(() => {
    const path = initialRoute || "/"
    return previewDomain.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`)
  }, [previewDomain, initialRoute])

  const sendKnobValues = useCallback((values: JsonObject) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:knob-values", values },
      "*",
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
      "*",
    )
  }, [])
  const isTouchDeviceRef = useRef(isTouchDevice)
  useEffect(() => {
    isTouchDeviceRef.current = isTouchDevice
    sendCursorMode(isTouchDevice)
  }, [isTouchDevice, sendCursorMode])

  const sendSharedState = useCallback((state: JsonObject) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:shared-state-apply", state },
      "*",
    )
  }, [])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!isScreenplayMessage(e.data)) return
      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      if (e.data.type === "screenplay:ready") {
        // The bridge expects an init state; the player has none, but sending
        // an empty state lets the bridge complete its handshake.
        iframe.contentWindow.postMessage(
          { type: "screenplay:init", state: {} },
          "*",
        )
        // Resend the current cursor mode — a navigation or reload re-injects
        // the bridge with default state, so the puck would otherwise reset.
        sendCursorMode(isTouchDeviceRef.current)
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
  }, [sendKnobValues, sendCursorMode, sendSharedState, iframeLayerId, collections])

  const handleKnobChange = useCallback(
    (next: JsonObject) => {
      setKnobValues(next)
      sendKnobValues(next)
    },
    [sendKnobValues],
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

  const handleToggleChat = useCallback(() => {
    const panel = chatPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

  const iframeStyle: React.CSSProperties = {
    pointerEvents: hudDragging ? "none" : "auto",
  }

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
            {devicePreset.category === "Desktop" ? (
              <iframe
                ref={iframeRef}
                src={initialSrc}
                title={`${roomName} — ${branch}`}
                className="h-full w-full border-0 bg-white dark:bg-zinc-900"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                style={iframeStyle}
              />
            ) : (
              <div
                className="relative shrink-0 overflow-hidden bg-white shadow-2xl ring-1 ring-white/10 dark:bg-zinc-900"
                style={{
                  width: devicePreset.width,
                  height: devicePreset.height,
                  transform: `scale(${fitScale})`,
                  transformOrigin: "center center",
                  borderRadius: devicePreset.cornerRadius,
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={initialSrc}
                  title={`${roomName} — ${branch}`}
                  className="h-full w-full border-0 bg-white dark:bg-zinc-900"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={iframeStyle}
                />
              </div>
            )}
          </div>
          <PlayerHud
            roomId={roomId}
            roomName={roomName}
            agentId={agentId}
            branch={branch}
            knobs={knobs}
            knobValues={knobValues}
            onKnobChange={handleKnobChange}
            onDraggingChange={setHudDragging}
            onToggleChat={handleToggleChat}
            chatOpen={!chatCollapsed}
            initialThreads={initialThreads}
            deviceSizeId={deviceSizeId}
            onDeviceSizeChange={handleDeviceSizeChange}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle
        className={`${chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"}${isTouchDevice ? " dark" : ""}`}
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
          className={
            isTouchDevice ? "dark h-full text-foreground" : "h-full"
          }
        >
          <PlayerChatHost
            roomId={roomId}
            agentId={agentId}
            onCollapse={() => chatPanelRef.current?.collapse()}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
