"use client"

import { useCallback, useRef } from "react"

interface UseDragOptions {
  zoom: number
  onDrag: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onClick?: (e: React.PointerEvent) => void
}

export function useArtboardDrag({
  zoom,
  onDrag,
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
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const dx = (e.clientX - lastPos.current.x) / zoom
      const dy = (e.clientY - lastPos.current.y) / zoom
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        didMove.current = true
      }
      lastPos.current = { x: e.clientX, y: e.clientY }
      onDrag(dx, dy)
    },
    [zoom, onDrag],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      if (!didMove.current) {
        onClick?.(e)
      } else {
        onDragEnd?.()
      }
    },
    [onDragEnd, onClick],
  )

  return { onPointerDown, onPointerMove, onPointerUp }
}
