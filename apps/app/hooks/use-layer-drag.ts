"use client"

import { useCallback, useRef } from "react"

interface UseDragOptions {
  zoom: number
  /**
   * Fires for every pointermove during a drag. `dx`/`dy` are the incremental
   * world-space delta since the last move; `totalDx`/`totalDy` are the
   * cumulative delta since pointerdown (snap-aware consumers use the
   * cumulative pair so they can recompute the snap target from the raw
   * cursor position every frame — the rect "sticks" because the snap absorbs
   * the cursor shift). `metaKey` reflects the live cmd/meta state on this
   * event so consumers can bypass snap while the user holds cmd.
   */
  onDrag: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean
  ) => void
  /** Fires once per gesture, the first time the cursor crosses the move threshold. */
  onDragStart?: () => void
  onDragEnd?: (metaKey: boolean) => void
  onClick?: (e: React.PointerEvent) => void
}

/** Pointer handlers returned by {@link useLayerDrag}, spread onto the
 *  element that should start a move-drag. */
export interface LayerDragHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
}

export function useLayerDrag({
  zoom,
  onDrag,
  onDragStart,
  onDragEnd,
  onClick,
}: UseDragOptions): LayerDragHandlers {
  const dragging = useRef(false)
  const didMove = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const totalDelta = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    dragging.current = true
    didMove.current = false
    lastPos.current = { x: e.clientX, y: e.clientY }
    totalDelta.current = { x: 0, y: 0 }
    // Capture on currentTarget (the element with the move/up listeners) not
    // e.target — pointerdown often lands on an inner child (e.g. the frame
    // name span has its own onPointerDown for instant-select). If selection
    // triggers a re-render mid-gesture, listeners on the outer div are
    // replaced; capturing on the leaf can drop the first pointermove.
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const dx = (e.clientX - lastPos.current.x) / zoom
      const dy = (e.clientY - lastPos.current.y) / zoom
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        if (!didMove.current) {
          didMove.current = true
          // Zero cumulative tracking at the dragStart event so it aligns with
          // any "starting state" the parent captures in onDragStart (e.g. the
          // snap-anchor union bbox). Pre-threshold moves are already applied
          // to the world and reflected in that captured state.
          totalDelta.current = { x: 0, y: 0 }
          onDragStart?.()
        }
      }
      lastPos.current = { x: e.clientX, y: e.clientY }
      totalDelta.current.x += dx
      totalDelta.current.y += dy
      onDrag(dx, dy, totalDelta.current.x, totalDelta.current.y, e.metaKey)
    },
    [zoom, onDrag, onDragStart]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      if (!didMove.current) {
        onClick?.(e)
      } else {
        onDragEnd?.(e.metaKey)
      }
    },
    [onDragEnd, onClick]
  )

  return { onPointerDown, onPointerMove, onPointerUp }
}
