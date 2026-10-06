"use client"

import { useEffect, useRef, type RefObject } from "react"

interface AnchorOffset {
  x: number
  y: number
  /** Hide the target this frame (it keeps being placed, so it shows in place). */
  hidden?: boolean
}

interface UseCanvasAnchoredPortalOptions {
  /**
   * Whether the positioning loop runs. Mirrors each call site's visibility
   * gate (toolbar shown, bubble anchored, etc.) — the loop is parked while
   * false and (re)starts when it flips true.
   */
  enabled: boolean
  /**
   * Element living inside the world transform (panning/zooming move it on
   * screen). Its client rect is re-read every frame to drive positioning.
   */
  anchorRef: RefObject<HTMLElement | null>
  /**
   * The portaled element, which lives in screen space outside the world
   * transform. Its `transform` is written every frame.
   */
  targetRef: RefObject<HTMLElement | null>
  /**
   * Computes the canvas-wrapper-relative offset to translate the target to,
   * from the anchor's screen rect and the canvas wrapper's screen rect. Read
   * fresh every frame, so it may close over live values (zoom, anchor coords)
   * without restarting the loop.
   */
  getOffset: (anchorRect: DOMRect, wrapperRect: DOMRect) => AnchorOffset
}

/**
 * Keep a portaled element anchored to a canvas-space target. The anchor lives
 * inside the world transform but the portaled element lives in screen space,
 * so we re-read the anchor's client rect every frame while enabled and write
 * the canvas-wrapper-relative offset directly to the target's `transform`.
 */
export function useCanvasAnchoredPortal({
  enabled,
  anchorRef,
  targetRef,
  getOffset,
}: UseCanvasAnchoredPortalOptions) {
  // Stash getOffset in a ref so the loop always reads the latest closure
  // without listing it (or the live values it captures) as an effect
  // dependency — those values update in place on the next frame.
  const getOffsetRef = useRef(getOffset)
  useEffect(() => {
    getOffsetRef.current = getOffset
  })

  useEffect(() => {
    if (!enabled) return
    const canvasWrapper = document.querySelector<HTMLDivElement>(
      "[data-canvas-wrapper]"
    )
    if (!canvasWrapper) return
    let rafId = 0
    const tick = () => {
      const anchor = anchorRef.current
      const target = targetRef.current
      if (anchor && target) {
        const { x, y, hidden } = getOffsetRef.current(
          anchor.getBoundingClientRect(),
          canvasWrapper.getBoundingClientRect()
        )
        target.style.transform = `translate(${x}px, ${y}px)`
        // Opacity hides the whole element in one paint. Visibility alone
        // isn't enough: it inherits into children, and a child with a
        // `transition-all` (every Button) animates it, so the buttons
        // outlast the bar they sit on. Visibility still takes it out of
        // hit-testing.
        const visibility = hidden ? "hidden" : ""
        if (target.style.visibility !== visibility) {
          target.style.visibility = visibility
          target.style.opacity = hidden ? "0" : ""
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [enabled, anchorRef, targetRef])
}
