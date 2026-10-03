"use client"

import { useCallback, useEffect, useRef } from "react"
import type { BridgePort } from "@/lib/bridge-port"
import type {
  HmrStatus,
  JsonObject,
  JsonValue,
} from "@/lib/postmessage-protocol"

interface UsePostMessageOptions {
  /** The page's bridge: an iframe's, or a Shared Frame's over its stream. */
  port: BridgePort
  iframeLayerId: string
  iframeState: JsonObject
  knobValues?: JsonObject
  sharedState?: JsonObject
  onStateChanged: (iframeLayerId: string, state: JsonObject) => void
  onNavigation?: (iframeLayerId: string, path: string, replace: boolean) => void
  onReady?: (iframeLayerId: string, version: string | undefined) => void
  onHmrStatus?: (iframeLayerId: string, status: HmrStatus) => void
  onKnobsDeclared?: (iframeLayerId: string, knobs: JsonValue[]) => void
  onSharedStateChanged?: (iframeLayerId: string, state: JsonObject) => void
}

export function usePostMessage({
  port,
  iframeLayerId,
  iframeState,
  knobValues,
  sharedState,
  onStateChanged,
  onNavigation,
  onReady,
  onHmrStatus,
  onKnobsDeclared,
  onSharedStateChanged,
}: UsePostMessageOptions) {
  const stateRef = useRef(iframeState)
  const knobValuesRef = useRef(knobValues)
  const sharedStateRef = useRef(sharedState)
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
    knobValuesRef.current = knobValues
    sharedStateRef.current = sharedState
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
      port.post({ type, state })
    },
    [port]
  )

  const sendKnobValues = useCallback(
    (values: JsonObject) => {
      port.post({ type: "screenplay:knob-values", values })
    },
    [port]
  )

  const sendSharedState = useCallback(
    (state: JsonObject, initial = false) => {
      port.post({ type: "screenplay:shared-state-apply", state, initial })
    },
    [port]
  )

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
    return port.subscribe((data) => {
      if (data.type === "screenplay:ready") {
        // Scroll is each viewer's own (#1518): nothing restores it from the
        // room, so a frame starts at the top and keeps its own scroll after.
        sendMessage("screenplay:init", stateRef.current)
        onReadyRef.current?.(iframeLayerId, data.version)
      } else if (data.type === "screenplay:state-changed") {
        onStateChanged(iframeLayerId, data.state)
      } else if (data.type === "screenplay:navigation") {
        onNavigation?.(iframeLayerId, data.path, !!data.replace)
      } else if (data.type === "screenplay:hmr-status") {
        onHmrStatusRef.current?.(iframeLayerId, data.status)
      } else if (data.type === "screenplay:knobs-declared") {
        // Push stored values down now that the iframe has registered the
        // knobs. Sending earlier (e.g. on screenplay:ready) drops the values:
        // applyValue() in screenplay-knobs ignores any id without a matching
        // definition, and definitions aren't registered until useKnob() runs.
        if (knobValuesRef.current) {
          sendKnobValues(knobValuesRef.current)
        }
        onKnobsDeclaredRef.current?.(iframeLayerId, data.knobs)
      } else if (data.type === "screenplay:shared-state") {
        // Record the serialized form so the next Yjs echo down to this same
        // iframe is suppressed (we'd otherwise apply our own update back).
        const next = data.state
        try {
          lastSharedStateRef.current = JSON.stringify(next)
        } catch {
          lastSharedStateRef.current = null
        }
        onSharedStateChangedRef.current?.(iframeLayerId, next)
      } else if (data.type === "screenplay:shared-state-request") {
        // A frame that just loaded asks for the room's state before it
        // publishes, so its defaults don't overwrite what the room has.
        // Always answer, even with an empty room: the frame holds its
        // publish until it hears back.
        const state = sharedStateRef.current ?? {}
        try {
          lastSharedStateRef.current = JSON.stringify(state)
        } catch {
          lastSharedStateRef.current = null
        }
        sendSharedState(state, true)
      }
    })
  }, [
    port,
    iframeLayerId,
    onStateChanged,
    onNavigation,
    sendMessage,
    sendKnobValues,
    sendSharedState,
  ])

  return { sendMessage }
}
