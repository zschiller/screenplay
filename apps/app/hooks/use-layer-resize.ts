"use client"

import { useCallback, useRef } from "react"

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

interface UseResizeOptions {
  zoom: number
  onResize: (
    edge: ResizeEdge,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => void
  onResizeStart?: (edge: ResizeEdge) => void
  onResizeEnd?: () => void
}

export function useLayerResize({
  zoom,
  onResize,
  onResizeStart,
  onResizeEnd,
}: UseResizeOptions) {
  const dragging = useRef(false)
  const edge = useRef<ResizeEdge | null>(null)
  const lastPos = useRef({ x: 0, y: 0 })

  const startResize = useCallback(
    (e: React.PointerEvent, side: ResizeEdge) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      dragging.current = true
      edge.current = side
      lastPos.current = { x: e.clientX, y: e.clientY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      onResizeStart?.(side)
    },
    [onResizeStart]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !edge.current) return
      const rawDx = (e.clientX - lastPos.current.x) / zoom
      const rawDy = (e.clientY - lastPos.current.y) / zoom
      lastPos.current = { x: e.clientX, y: e.clientY }

      let dx = 0,
        dy = 0,
        dw = 0,
        dh = 0
      const dir = edge.current

      if (dir.includes("e")) dw = rawDx
      if (dir.includes("w")) {
        dx = rawDx
        dw = -rawDx
      }
      if (dir.includes("s")) dh = rawDy
      if (dir.includes("n")) {
        dy = rawDy
        dh = -rawDy
      }

      onResize(dir, dx, dy, dw, dh)
    },
    [zoom, onResize]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      edge.current = null
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      onResizeEnd?.()
    },
    [onResizeEnd]
  )

  const makeHandleProps = useCallback(
    (side: ResizeEdge) => ({
      onPointerDown: (e: React.PointerEvent) => startResize(e, side),
      onPointerMove,
      onPointerUp,
    }),
    [startResize, onPointerMove, onPointerUp]
  )

  return { makeHandleProps }
}
