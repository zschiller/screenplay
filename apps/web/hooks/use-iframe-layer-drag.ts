"use client"

import { useCallback, useRef } from "react"

interface UseDragOptions {
  zoom: number
  onDrag: (dx: number, dy: number) => void
  /** Fires once per gesture, the first time the cursor crosses the move threshold. */
  onDragStart?: () => void
  onDragEnd?: (metaKey: boolean) => void
  onClick?: (e: React.PointerEvent) => void
}

export function useIframeLayerDrag({
  zoom,
  onDrag,
  onDragStart,
  onDragEnd,
  onClick,
}: UseDragOptions) {
  const dragging = useRef(false)
  const didMove = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      dragging.current = true
      didMove.current = false
      lastPos.current = { x: e.clientX, y: e.clientY }
      // Capture on currentTarget (the element with the move/up listeners) not
      // e.target — pointerdown often lands on an inner child (e.g. the frame
      // name span has its own onPointerDown for instant-select). If selection
      // triggers a re-render mid-gesture, listeners on the outer div are
      // replaced; capturing on the leaf can drop the first pointermove.
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const dx = (e.clientX - lastPos.current.x) / zoom
      const dy = (e.clientY - lastPos.current.y) / zoom
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        if (!didMove.current) {
          didMove.current = true
          onDragStart?.()
        }
      }
      lastPos.current = { x: e.clientX, y: e.clientY }
      onDrag(dx, dy)
    },
    [zoom, onDrag, onDragStart],
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
    [onDragEnd, onClick],
  )

  return { onPointerDown, onPointerMove, onPointerUp }
}
