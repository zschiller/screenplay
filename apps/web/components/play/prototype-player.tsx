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
  DEFAULT_ARTBOARD_SIZE_ID,
  getArtboardSizePreset,
  type ArtboardSizeCategory,
} from "@/lib/artboard-sizes"
import { PlayerHud } from "./player-hud"
import { PlayerChatHost } from "./player-chat-host"

interface PrototypePlayerProps {
  roomId: string
  projectName: string
  agentId: string
  branch: string
  previewDomain: string
  initialRoute: string
  initialKnobValues: Record<string, unknown>
  initialThreads: ThreadWithComments[]
  /** Workspace's default artboard size id — seeds mobile/tablet preview if it's a non-desktop preset. */
  initialDeviceSizeId?: string
}

const DEVICE_PADDING = 48
const STORAGE_KEY_DEVICE = "screenplay:player-device-size"

/** Per-category corner radius for the device frame. Desktop is full-bleed and unrounded. */
const DEVICE_RADIUS_PX: Record<ArtboardSizeCategory, number> = {
  Desktop: 0,
  Tablet: 24,
  Mobile: 44,
}

export function PrototypePlayer({
  roomId,
  projectName,
  agentId,
  branch,
  previewDomain,
  initialRoute,
  initialKnobValues,
  initialThreads,
  initialDeviceSizeId,
}: PrototypePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [knobs, setKnobs] = useState<JsonValue[]>([])
  const [knobValues, setKnobValues] = useState<JsonObject>(
    initialKnobValues as JsonObject,
  )
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
  // this session, then the workspace default, then desktop full-bleed.
  const [deviceSizeId, setDeviceSizeId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(STORAGE_KEY_DEVICE)
      if (saved) return saved
    }
    return initialDeviceSizeId ?? DEFAULT_ARTBOARD_SIZE_ID
  })
  const handleDeviceSizeChange = useCallback((id: string) => {
    setDeviceSizeId(id)
    try {
      window.localStorage.setItem(STORAGE_KEY_DEVICE, id)
    } catch {}
  }, [])
  const devicePreset = getArtboardSizePreset(deviceSizeId)
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
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [sendKnobValues, sendCursorMode])

  const handleKnobChange = useCallback(
    (next: JsonObject) => {
      setKnobValues(next)
      sendKnobValues(next)
    },
    [sendKnobValues],
  )

  const handleToggleChat = useCallback(() => {
    const panel = chatPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

  const radius = DEVICE_RADIUS_PX[devicePreset.category]
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
                title={`${projectName} — ${branch}`}
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
                  borderRadius: radius,
                  transform: `scale(${fitScale})`,
                  transformOrigin: "center center",
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={initialSrc}
                  title={`${projectName} — ${branch}`}
                  className="h-full w-full border-0 bg-white dark:bg-zinc-900"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={iframeStyle}
                />
              </div>
            )}
          </div>
          <PlayerHud
            roomId={roomId}
            projectName={projectName}
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
        className={chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"}
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
        <PlayerChatHost
          roomId={roomId}
          agentId={agentId}
          onCollapse={() => chatPanelRef.current?.collapse()}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
