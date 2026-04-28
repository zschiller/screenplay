"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  isScreenplayMessage,
  type JsonObject,
  type JsonValue,
} from "@/lib/postmessage-protocol"
import type { BranchCommentRecord } from "@/lib/branch-comments"
import { PlayerHud } from "./player-hud"

interface PrototypePlayerProps {
  roomId: string
  projectName: string
  agentId: string
  branch: string
  previewDomain: string
  initialRoute: string
  initialKnobValues: Record<string, unknown>
  initialComments: BranchCommentRecord[]
}

export function PrototypePlayer({
  roomId,
  projectName,
  agentId,
  branch,
  previewDomain,
  initialRoute,
  initialKnobValues,
  initialComments,
}: PrototypePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [knobs, setKnobs] = useState<JsonValue[]>([])
  const [knobValues, setKnobValues] = useState<JsonObject>(
    initialKnobValues as JsonObject,
  )
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

  return (
    <div className="fixed inset-0 bg-black">
      <iframe
        ref={iframeRef}
        src={initialSrc}
        title={`${projectName} — ${branch}`}
        className="h-full w-full border-0 bg-white dark:bg-zinc-900"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
      <PlayerHud
        roomId={roomId}
        projectName={projectName}
        agentId={agentId}
        branch={branch}
        knobs={knobs}
        knobValues={knobValues}
        onKnobChange={handleKnobChange}
        initialComments={initialComments}
      />
    </div>
  )
}
