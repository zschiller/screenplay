"use client"

import { useCallback, useEffect, useRef } from "react"
import type { HmrStatus, JsonObject } from "@/lib/postmessage-protocol"
import { isScreenplayMessage } from "@/lib/postmessage-protocol"

interface UsePostMessageOptions {
  artboardId: string
  iframeState: JsonObject
  onStateChanged: (artboardId: string, state: JsonObject) => void
  onNavigation?: (artboardId: string, path: string) => void
  onReady?: (artboardId: string, version: string | undefined) => void
  onHmrStatus?: (artboardId: string, status: HmrStatus) => void
}

export function usePostMessage({
  artboardId,
  iframeState,
  onStateChanged,
  onNavigation,
  onReady,
  onHmrStatus,
}: UsePostMessageOptions) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const stateRef = useRef(iframeState)
  stateRef.current = iframeState
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onHmrStatusRef = useRef(onHmrStatus)
  onHmrStatusRef.current = onHmrStatus

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
        onReadyRef.current?.(artboardId, e.data.version)
      } else if (e.data.type === "screenplay:state-changed") {
        onStateChanged(artboardId, e.data.state)
      } else if (e.data.type === "screenplay:navigation") {
        onNavigation?.(artboardId, e.data.path)
      } else if (e.data.type === "screenplay:hmr-status") {
        onHmrStatusRef.current?.(artboardId, e.data.status)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [artboardId, onStateChanged, onNavigation, sendMessage])

  return { iframeRef, sendMessage }
}
