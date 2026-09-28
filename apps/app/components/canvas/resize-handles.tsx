"use client"

import type { ResizeEdge } from "@/hooks/use-layer-resize"

interface ResizeHandlesProps {
  zoom: number
  makeHandleProps: (edge: ResizeEdge) => {
    onPointerDown: (e: React.PointerEvent) => void
  }
  /** Screen px of chrome attached above the tile (a frame's header). The top
   *  handles move up onto its top edge so they sit where the outline is. */
  topInset?: number
}

/**
 * The 8 resize handles (4 edges + 4 corners) that wrap a singly-selected
 * canvas tile (iframeLayer or document). Sized in screen-pixel units so the
 * grab targets stay usable at any zoom; corners are oversized so they win
 * over the adjacent edge regions, which inset by `cornerSize` to avoid
 * overlap. Parent must be `position: relative`.
 */
export function ResizeHandles({
  zoom,
  makeHandleProps,
  topInset = 0,
}: ResizeHandlesProps) {
  const HANDLE = 6 // base px thickness of edge handles
  const h = HANDLE / zoom
  const hHalf = h / 2
  const cornerSize = 12 / zoom
  const cHalf = cornerSize / 2
  const inset = topInset / zoom

  return (
    <>
      <div
        className="absolute cursor-ns-resize touch-none"
        {...makeHandleProps("n")}
        style={{ top: -hHalf - inset, left: cHalf, right: cHalf, height: h }}
      />
      <div
        className="absolute cursor-ns-resize touch-none"
        {...makeHandleProps("s")}
        style={{ bottom: -hHalf, left: cHalf, right: cHalf, height: h }}
      />
      <div
        className="absolute cursor-ew-resize touch-none"
        {...makeHandleProps("w")}
        style={{ left: -hHalf, top: cHalf - inset, bottom: cHalf, width: h }}
      />
      <div
        className="absolute cursor-ew-resize touch-none"
        {...makeHandleProps("e")}
        style={{ right: -hHalf, top: cHalf - inset, bottom: cHalf, width: h }}
      />
      <div
        className="absolute cursor-nwse-resize touch-none"
        {...makeHandleProps("nw")}
        style={{
          top: -cHalf - inset,
          left: -cHalf,
          width: cornerSize,
          height: cornerSize,
        }}
      />
      <div
        className="absolute cursor-nesw-resize touch-none"
        {...makeHandleProps("ne")}
        style={{
          top: -cHalf - inset,
          right: -cHalf,
          width: cornerSize,
          height: cornerSize,
        }}
      />
      <div
        className="absolute cursor-nesw-resize touch-none"
        {...makeHandleProps("sw")}
        style={{
          bottom: -cHalf,
          left: -cHalf,
          width: cornerSize,
          height: cornerSize,
        }}
      />
      <div
        className="absolute cursor-nwse-resize touch-none"
        {...makeHandleProps("se")}
        style={{
          bottom: -cHalf,
          right: -cHalf,
          width: cornerSize,
          height: cornerSize,
        }}
      />
    </>
  )
}
