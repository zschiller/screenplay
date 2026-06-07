"use client"

import { useCallback, useEffect, useRef } from "react"
import type { RefObject } from "react"
import type {
  HmrStatus,
  JsonObject,
  JsonValue,
} from "@/lib/postmessage-protocol"
import { isScreenplayMessage } from "@/lib/postmessage-protocol"

interface UsePostMessageOptions {
  // The iframe element ref. Passed in by the caller (rather than created here)
  // so callers can reference the iframe in callbacks declared before this hook
  // is called.
  iframeRef: RefObject<HTMLIFrameElement | null>
  iframeLayerId: string
  iframeState: JsonObject
  iframeScrollX?: number
  iframeScrollY?: number
  knobValues?: JsonObject
  sharedState?: JsonObject
  onStateChanged: (iframeLayerId: string, state: JsonObject) => void
  onNavigation?: (
    iframeLayerId: string,
    path: string,
    replace: boolean
  ) => void
  onScroll?: (iframeLayerId: string, scrollX: number, scrollY: number) => void
  onReady?: (iframeLayerId: string, version: string | undefined) => void
  onHmrStatus?: (iframeLayerId: string, status: HmrStatus) => void
  onKnobsDeclared?: (iframeLayerId: string, knobs: JsonValue[]) => void
  onSharedStateChanged?: (iframeLayerId: string, state: JsonObject) => void
}

export function usePostMessage({
  iframeRef,
  iframeLayerId,
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
  const stateRef = useRef(iframeState)
  const scrollRef = useRef<{ x: number; y: number } | null>(
    iframeScrollX !== undefined || iframeScrollY !== undefined
      ? { x: iframeScrollX ?? 0, y: iframeScrollY ?? 0 }
      : null
  )
  // Last scroll position we either received from or applied to the iframe.
  // Used to avoid looping remote scrolls back to the iframe when Yjs echoes
  // them to us a moment later.
  const lastScrollRef = useRef<{ x: number; y: number } | null>(null)
  const knobValuesRef = useRef(knobValues)
  // Tracks the last sharedState we either received from or pushed down to the
  // iframe. Used to suppress echoes when Yjs sends our own update back to us.
  const lastSharedStateRef = useRef<string | null>(null)
  const onReadyRef = useRef(onReady)
  const onHmrStatusRef = useRef(onHmrStatus)
  const onKnobsDeclaredRef = useRef(onKnobsDeclared)
  const onSharedStateChangedRef = useRef(onSharedStateChanged)

  // Keep the "latest value" refs current. Written in an effect (not during
  // render) so they reflect the value as of the last committed render; every
  // reader below runs after commit (event handlers, post-ready callbacks).
  useEffect(() => {
    stateRef.current = iframeState
    scrollRef.current =
      iframeScrollX !== undefined || iframeScrollY !== undefined
        ? { x: iframeScrollX ?? 0, y: iframeScrollY ?? 0 }
        : null
    knobValuesRef.current = knobValues
    onReadyRef.current = onReady
    onHmrStatusRef.current = onHmrStatus
    onKnobsDeclaredRef.current = onKnobsDeclared
    onSharedStateChangedRef.current = onSharedStateChanged
  })

  const sendMessage = useCallback(
    (
      type: "screenplay:init" | "screenplay:state-update",
      state: JsonObject
    ) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage({ type, state }, "*")
    },
    [iframeRef]
  )

  const sendKnobValues = useCallback(
    (values: JsonObject) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage(
        { type: "screenplay:knob-values", values },
        "*"
      )
    },
    [iframeRef]
  )

  const sendSharedState = useCallback(
    (state: JsonObject) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage(
        { type: "screenplay:shared-state-apply", state },
        "*"
      )
    },
    [iframeRef]
  )

  const sendScrollTo = useCallback(
    (x: number, y: number) => {
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      const last = lastScrollRef.current
      if (last && last.x === x && last.y === y) return
      lastScrollRef.current = { x, y }
      iframe.contentWindow.postMessage(
        { type: "screenplay:scroll-to", scrollX: x, scrollY: y },
        "*"
      )
    },
    [iframeRef]
  )

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
        onReadyRef.current?.(iframeLayerId, e.data.version)
      } else if (e.data.type === "screenplay:state-changed") {
        onStateChanged(iframeLayerId, e.data.state)
      } else if (e.data.type === "screenplay:navigation") {
        onNavigation?.(iframeLayerId, e.data.path, !!e.data.replace)
      } else if (e.data.type === "screenplay:scroll") {
        lastScrollRef.current = { x: e.data.scrollX, y: e.data.scrollY }
        onScroll?.(iframeLayerId, e.data.scrollX, e.data.scrollY)
      } else if (e.data.type === "screenplay:hmr-status") {
        onHmrStatusRef.current?.(iframeLayerId, e.data.status)
      } else if (e.data.type === "screenplay:knobs-declared") {
        // Push stored values down now that the iframe has registered the
        // knobs. Sending earlier (e.g. on screenplay:ready) drops the values:
        // applyValue() in screenplay-knobs ignores any id without a matching
        // definition, and definitions aren't registered until useKnob() runs.
        if (knobValuesRef.current) {
          sendKnobValues(knobValuesRef.current)
        }
        onKnobsDeclaredRef.current?.(iframeLayerId, e.data.knobs)
      } else if (e.data.type === "screenplay:shared-state") {
        // Record the serialized form so the next Yjs echo down to this same
        // iframe is suppressed (we'd otherwise apply our own update back).
        const next = e.data.state
        try {
          lastSharedStateRef.current = JSON.stringify(next)
        } catch {
          lastSharedStateRef.current = null
        }
        onSharedStateChangedRef.current?.(iframeLayerId, next)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [
    iframeRef,
    iframeLayerId,
    onStateChanged,
    onNavigation,
    onScroll,
    sendMessage,
    sendScrollTo,
    sendKnobValues,
  ])

  return { iframeRef, sendMessage }
}
