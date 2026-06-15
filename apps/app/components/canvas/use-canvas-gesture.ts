import { useCallback, useEffect, useRef, useState } from "react"
import {
  EMPTY_PREVIEW,
  reduceGesture,
  type GestureEvent,
  type GestureIntent,
  type GesturePreview,
  type GestureState,
} from "@/lib/canvas/gesture"

/**
 * Thin React seam over the pure Canvas Gesture FSM (`lib/canvas/gesture.ts`).
 * Holds the single gesture-state ref, runs each pointer/key event through
 * `reduceGesture`, exposes the {@link GesturePreview} for `deriveCanvasLayout`
 * to consume, and applies emitted {@link GestureIntent}s via the Canvas
 * Operations passed in. All the logic is in the reducer; this hook is wiring —
 * it never computes geometry and never touches the Y.Doc itself.
 *
 * The state lives in a ref (read synchronously by pointer handlers without
 * re-binding); the preview lives in state so a `move` re-renders the canvas and
 * the in-flight layout reflows.
 */
export function useCanvasGesture(applyIntent: (intent: GestureIntent) => void) {
  const stateRef = useRef<GestureState>({ kind: "idle" })
  const [preview, setPreview] = useState<GesturePreview>(EMPTY_PREVIEW)

  // Keep the latest `applyIntent` in a ref so `dispatch` stays stable and can be
  // called regardless of where the Canvas Operations it forwards to are defined
  // in the component body.
  const applyIntentRef = useRef(applyIntent)
  useEffect(() => {
    applyIntentRef.current = applyIntent
  })

  const dispatch = useCallback((event: GestureEvent) => {
    const result = reduceGesture(stateRef.current, event)
    stateRef.current = result.state
    setPreview(result.preview)
    if (result.intent) applyIntentRef.current(result.intent)
  }, [])

  /** Current FSM state — read by pointer handlers to route events. */
  const getState = useCallback(() => stateRef.current, [])

  return { preview, dispatch, getState }
}
