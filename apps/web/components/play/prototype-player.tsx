"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  }, [sendKnobValues])

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

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="fixed inset-0 bg-black"
    >
      <ResizablePanel id="player-canvas" minSize="200px">
        <div className="relative h-full w-full">
          <iframe
            ref={iframeRef}
            src={initialSrc}
            title={`${projectName} — ${branch}`}
            className="h-full w-full border-0 bg-white dark:bg-zinc-900"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ pointerEvents: hudDragging ? "none" : "auto" }}
          />
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
