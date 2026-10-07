"use client"

import { useState, useSyncExternalStore } from "react"
import { FILE_DRAG_TYPE, fileDrag } from "@/lib/canvas/file-drag"
import {
  fileDropTarget,
  type FileDropTarget,
} from "@/lib/canvas/file-placement"
import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import { IFRAME_LAYER_GROUP_GAP } from "@/lib/constants"

type Camera = { positionX: number; positionY: number; scale: number }

type Hover =
  | { kind: "group"; target: FileDropTarget; bar: Rect }
  | { kind: "free"; at: { x: number; y: number }; box: Rect }

type Rect = { x: number; y: number; width: number; height: number }

/**
 * Where a Document or Mockup tile dragged out of the chat lands on the canvas
 * (#1887). While one is in the air this lies over the layers, so a frame's
 * page can't swallow the drag, and shows where it would go: a bar in the gap
 * it would take in the Group under the pointer, or the view's outline centred
 * on the pointer on empty canvas. Dropping hands the spot to `onDrop`.
 */
export function FileDropSurface({
  layouts,
  camera,
  sizeOf,
  onDrop,
}: {
  /** The current page's member layouts. A lone member's Group shows no
   *  gap, so its bar sits the default gap off its edge. */
  layouts: IframeLayerLayoutMap
  /** The camera now, to turn the pointer into world space. */
  camera: () => Camera | null
  /** The size a new view of the file takes, in world space. */
  sizeOf: (fileId: string) => { width: number; height: number } | undefined
  onDrop: (
    fileId: string,
    at: FileDropTarget | { x: number; y: number }
  ) => void
}) {
  const dragging = useSyncExternalStore(
    fileDrag.subscribe,
    fileDrag.current,
    () => null
  )
  const [hover, setHover] = useState<Hover | null>(null)
  if (!dragging) return null

  const locate = (e: React.DragEvent<HTMLDivElement>): Hover | null => {
    const cam = camera()
    if (!cam) return null
    const box = e.currentTarget.getBoundingClientRect()
    const point = {
      x: (e.clientX - box.left - cam.positionX) / cam.scale,
      y: (e.clientY - box.top - cam.positionY) / cam.scale,
    }
    const toScreen = (r: Rect): Rect => ({
      x: r.x * cam.scale + cam.positionX,
      y: r.y * cam.scale + cam.positionY,
      width: r.width * cam.scale,
      height: r.height * cam.scale,
    })
    const target = fileDropTarget(layouts.values(), point)
    if (target) {
      return {
        kind: "group",
        target,
        bar: toScreen(gapBar(layouts, target)),
      }
    }
    const size = sizeOf(dragging) ?? { width: 0, height: 0 }
    return {
      kind: "free",
      at: point,
      box: toScreen({
        x: point.x - size.width / 2,
        y: point.y - size.height / 2,
        ...size,
      }),
    }
  }

  return (
    <div
      data-testid="file-drop-surface"
      className="absolute inset-0 z-(--z-canvas-presence)"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FILE_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setHover(locate(e))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setHover(null)
      }}
      onDrop={(e) => {
        const fileId = e.dataTransfer.getData(FILE_DRAG_TYPE) || dragging
        e.preventDefault()
        const spot = locate(e)
        setHover(null)
        fileDrag.end()
        if (!spot) return
        onDrop(fileId, spot.kind === "group" ? spot.target : spot.at)
      }}
    >
      {hover?.kind === "group" && (
        <div
          data-testid="file-drop-bar"
          className="pointer-events-none absolute bg-(--canvas-selection)"
          style={{
            left: Math.round(hover.bar.x) - 1,
            top: Math.round(hover.bar.y),
            width: 2,
            height: Math.round(hover.bar.height),
          }}
        />
      )}
      {hover?.kind === "free" && (
        <div
          data-testid="file-drop-outline"
          className="pointer-events-none absolute border border-(--canvas-selection)"
          style={{
            left: Math.round(hover.box.x),
            top: Math.round(hover.box.y),
            width: Math.round(hover.box.width),
            height: Math.round(hover.box.height),
          }}
        />
      )}
    </div>
  )
}

/** The world-space line in the Group's gap a dropped view would take. */
function gapBar(layouts: IframeLayerLayoutMap, target: FileDropTarget): Rect {
  const members = [...layouts.values()]
    .filter((m) => m.groupId === target.groupId)
    .sort((a, b) => a.x - b.x)
  const top = Math.min(...members.map((m) => m.y))
  const bottom = Math.max(...members.map((m) => m.y + m.height))
  const first = members[0]!
  const last = members.at(-1)!
  const gap =
    members.length > 1
      ? members[1]!.x - (first.x + first.width)
      : IFRAME_LAYER_GROUP_GAP
  const x =
    target.index === 0
      ? first.x - gap / 2
      : target.index >= members.length
        ? last.x + last.width + gap / 2
        : (members[target.index - 1]!.x +
            members[target.index - 1]!.width +
            members[target.index]!.x) /
          2
  return { x, y: top, width: 0, height: bottom - top }
}
