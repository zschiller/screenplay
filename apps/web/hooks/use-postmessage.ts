"use client"

import { useCallback, useEffect, useRef } from "react"
import type { HmrStatus, JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import { isScreenplayMessage } from "@/lib/postmessage-protocol"

interface UsePostMessageOptions {
  artboardId: string
  iframeState: JsonObject
  iframeScrollX?: number
  iframeScrollY?: number
  knobValues?: JsonObject
  sharedState?: JsonObject
  onStateChanged: (artboardId: string, state: JsonObject) => void
  onNavigation?: (artboardId: string, path: string) => void
  onScroll?: (artboardId: string, scrollX: number, scrollY: number) => void
  onReady?: (artboardId: string, version: string | undefined) => void
  onHmrStatus?: (artboardId: string, status: HmrStatus) => void
  onKnobsDeclared?: (artboardId: string, knobs: JsonValue[]) => void
  onSharedStateChanged?: (artboardId: string, state: JsonObject) => void
}

export function usePostMessage({
  artboardId,
  iframeState,
  iframeScrollX,
  iframeScrollY,
  knobValues,
  sharedState,
  onStateChanged,
  onNavigation,
  onScroll,
  onReady,
  onHmrStatus,
  onKnobsDeclared,
  onSharedStateChanged,
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
  const knobValuesRef = useRef(knobValues)
  knobValuesRef.current = knobValues
  // Tracks the last sharedState we either received from or pushed down to the
  // iframe. Used to suppress echoes when Yjs sends our own update back to us.
  const lastSharedStateRef = useRef<string | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onHmrStatusRef = useRef(onHmrStatus)
  onHmrStatusRef.current = onHmrStatus
  const onKnobsDeclaredRef = useRef(onKnobsDeclared)
  onKnobsDeclaredRef.current = onKnobsDeclared
  const onSharedStateChangedRef = useRef(onSharedStateChanged)
  onSharedStateChangedRef.current = onSharedStateChanged

  const sendMessage = useCallback(
    (type: "screenplay:init" | "screenplay:state-update", state: JsonObject) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage({ type, state }, "*")
    },
    [],
  )

  const sendKnobValues = useCallback((values: JsonObject) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:knob-values", values },
      "*",
    )
  }, [])

  const sendSharedState = useCallback((state: JsonObject) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      { type: "screenplay:shared-state-apply", state },
      "*",
    )
  }, [])

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

  // Push knob value changes from Yjs down into the iframe.
  useEffect(() => {
    if (!knobValues) return
    sendKnobValues(knobValues)
  }, [knobValues, sendKnobValues])

  // Push shared-state changes from Yjs down into the iframe — but skip our
  // own echoes. The iframe's runtime also diffs incoming state, so an echo
  // would no-op there too, but suppressing the postMessage entirely keeps
  // the wire quiet.
  useEffect(() => {
    if (!sharedState) return
    const serialized = JSON.stringify(sharedState)
    if (serialized === lastSharedStateRef.current) return
    lastSharedStateRef.current = serialized
    sendSharedState(sharedState)
  }, [sharedState, sendSharedState])

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
      } else if (e.data.type === "screenplay:knobs-declared") {
        // Push stored values down now that the iframe has registered the
        // knobs. Sending earlier (e.g. on screenplay:ready) drops the values:
        // applyValue() in screenplay-knobs ignores any id without a matching
        // definition, and definitions aren't registered until useKnob() runs.
        if (knobValuesRef.current) {
          sendKnobValues(knobValuesRef.current)
        }
        onKnobsDeclaredRef.current?.(artboardId, e.data.knobs)
      } else if (e.data.type === "screenplay:shared-state") {
        // Record the serialized form so the next Yjs echo down to this same
        // iframe is suppressed (we'd otherwise apply our own update back).
        const next = e.data.state
        try {
          lastSharedStateRef.current = JSON.stringify(next)
        } catch {
          lastSharedStateRef.current = null
        }
        onSharedStateChangedRef.current?.(artboardId, next)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [artboardId, onStateChanged, onNavigation, onScroll, sendMessage, sendScrollTo, sendKnobValues])

  return { iframeRef, sendMessage }
}
