"use client"

import { useCallback, useEffect, useRef } from "react"
import type { HmrStatus, JsonObject } from "@/lib/postmessage-protocol"
import { isScreenplayMessage } from "@/lib/postmessage-protocol"

interface UsePostMessageOptions {
  artboardId: string
  iframeState: JsonObject
  iframeScrollX?: number
  iframeScrollY?: number
  onStateChanged: (artboardId: string, state: JsonObject) => void
  onNavigation?: (artboardId: string, path: string) => void
  onScroll?: (artboardId: string, scrollX: number, scrollY: number) => void
  onReady?: (artboardId: string, version: string | undefined) => void
  onHmrStatus?: (artboardId: string, status: HmrStatus) => void
}

export function usePostMessage({
  artboardId,
  iframeState,
  iframeScrollX,
  iframeScrollY,
  onStateChanged,
  onNavigation,
  onScroll,
  onReady,
  onHmrStatus,
}: UsePostMessageOptions) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const stateRef = useRef(iframeState)
  stateRef.current = iframeState
  const scrollRef = useRef<{ x: number; y: number } | null>(
    iframeScrollX !== undefined || iframeScrollY !== undefined
      ? { x: iframeScrollX ?? 0, y: iframeScrollY ?? 0 }
      : null,
  )
  scrollRef.current =
    iframeScrollX !== undefined || iframeScrollY !== undefined
      ? { x: iframeScrollX ?? 0, y: iframeScrollY ?? 0 }
      : null
  // Last scroll position we either received from or applied to the iframe.
  // Used to avoid looping remote scrolls back to the iframe when Yjs echoes
  // them to us a moment later.
  const lastScrollRef = useRef<{ x: number; y: number } | null>(null)
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

  const sendScrollTo = useCallback((x: number, y: number) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    const last = lastScrollRef.current
    if (last && last.x === x && last.y === y) return
    lastScrollRef.current = { x, y }
    iframe.contentWindow.postMessage(
      { type: "screenplay:scroll-to", scrollX: x, scrollY: y },
      "*",
    )
  }, [])

  // Push scroll changes from Yjs down into the iframe.
  useEffect(() => {
    if (iframeScrollX === undefined && iframeScrollY === undefined) return
    sendScrollTo(iframeScrollX ?? 0, iframeScrollY ?? 0)
  }, [iframeScrollX, iframeScrollY, sendScrollTo])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!isScreenplayMessage(e.data)) return

      const iframe = iframeRef.current
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return

      if (e.data.type === "screenplay:ready") {
        sendMessage("screenplay:init", stateRef.current)
        if (scrollRef.current) {
          sendScrollTo(scrollRef.current.x, scrollRef.current.y)
        }
        onReadyRef.current?.(artboardId, e.data.version)
      } else if (e.data.type === "screenplay:state-changed") {
        onStateChanged(artboardId, e.data.state)
      } else if (e.data.type === "screenplay:navigation") {
        onNavigation?.(artboardId, e.data.path)
      } else if (e.data.type === "screenplay:scroll") {
        lastScrollRef.current = { x: e.data.scrollX, y: e.data.scrollY }
        onScroll?.(artboardId, e.data.scrollX, e.data.scrollY)
      } else if (e.data.type === "screenplay:hmr-status") {
        onHmrStatusRef.current?.(artboardId, e.data.status)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [artboardId, onStateChanged, onNavigation, onScroll, sendMessage, sendScrollTo])

  return { iframeRef, sendMessage }
}
