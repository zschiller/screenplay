"use client"

import { createContext, useContext, useLayoutEffect, useRef } from "react"

/**
 * The canvas zoom as it moves, frame by frame. The camera defers the React
 * `zoom` until a gesture settles (see `use-canvas-camera.ts`), so anything that
 * counter-scales from it snaps at the end of each step. An element that must
 * hold its on-screen size through the gesture subscribes here and writes its
 * own style, with no React render.
 */
export interface LiveZoom {
  subscribe(listener: () => void): () => void
  get(): number
}

export const LiveZoomContext = createContext<LiveZoom | null>(null)

/**
 * Runs `apply` with the live zoom on every transform frame while mounted, and
 * once on mount. Outside a canvas (play mode) it never runs. Keep
 * `apply` to style writes on refs: it runs ~60 times a second mid-zoom.
 */
export function useLiveZoom(apply: (zoom: number) => void) {
  const live = useContext(LiveZoomContext)
  const applyRef = useRef(apply)
  useLayoutEffect(() => {
    applyRef.current = apply
  })
  useLayoutEffect(() => {
    if (!live) return
    const run = () => applyRef.current(live.get())
    run()
    return live.subscribe(run)
  }, [live])
}
