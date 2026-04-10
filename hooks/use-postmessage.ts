"use client"

import { useCallback, useEffect, useRef } from "react"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { isScreenplayMessage } from "@/lib/postmessage-protocol"

interface UsePostMessageOptions {
  artboardId: string
  iframeState: JsonObject
  onStateChanged: (artboardId: string, state: JsonObject) => void
}

export function usePostMessage({
  artboardId,
  iframeState,
  onStateChanged,
}: UsePostMessageOptions) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const stateRef = useRef(iframeState)
  stateRef.current = iframeState

  const sendMessage = useCallback(
    (type: "screenplay:init" | "screenplay:state-update", state: JsonObject) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage({ type, state }, "*")
    },
    [],
  )

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!isScreenplayMessage(e.data)) return

      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      if (e.data.type === "screenplay:ready") {
        sendMessage("screenplay:init", stateRef.current)
      } else if (e.data.type === "screenplay:state-changed") {
        onStateChanged(artboardId, e.data.state)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [artboardId, onStateChanged, sendMessage])

  return { iframeRef, sendMessage }
}
