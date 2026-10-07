"use client"

import { useState, useSyncExternalStore } from "react"
import type { Editor } from "@tiptap/core"
import { FILE_DRAG_TYPE, fileDrag } from "@/lib/canvas/file-drag"
import { blockGapAt, laidOutBlocks } from "@/lib/document-embed"
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
  | { kind: "document"; spot: DocumentEmbedSpot; line: Rect }

/**
 * Where a Mockup tile dropped on a Document would embed it (#1888): the
 * Document, the gap between its blocks nearest the pointer (as an editor
 * position), and the line that gap sits on, in screen pixels.
 */
export type DocumentEmbedSpot = {
  documentId: string
  pos: number
  line: { left: number; top: number; width: number }
}

type Rect = { x: number; y: number; width: number; height: number }

/**
 * Where a Document or Mockup tile dragged out of the chat lands on the canvas
 * (#1887). While one is in the air this lies over the layers, so a frame's
 * page can't swallow the drag, and shows where it would go: a bar in the gap
 * it would take in the Group under the pointer, or the view's outline centred
 * on the pointer on empty canvas. Dropping hands the spot to `onDrop`. A
 * Mockup over a Document's text embeds there instead (#1888): a line shows
 * the gap between blocks it would take, and dropping hands it to `onEmbed`.
 */
export function FileDropSurface({
  layouts,
  camera,
  sizeOf,
  onDrop,
  embedAt,
  onEmbed,
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
  /** Where the file would embed under a screen point, if it can there. */
  embedAt?: (
    fileId: string,
    clientX: number,
    clientY: number
  ) => DocumentEmbedSpot | null
  onEmbed?: (fileId: string, spot: DocumentEmbedSpot) => void
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
    const spot = embedAt?.(dragging, e.clientX, e.clientY)
    if (spot) {
      return {
        kind: "document",
        spot,
        line: {
          x: spot.line.left - box.left,
          y: spot.line.top - box.top,
          width: spot.line.width,
          height: 0,
        },
      }
    }
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
        if (spot.kind === "document") onEmbed?.(fileId, spot.spot)
        else onDrop(fileId, spot.kind === "group" ? spot.target : spot.at)
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
      {hover?.kind === "document" && (
        <div
          data-testid="file-drop-line"
          className="pointer-events-none absolute bg-(--canvas-selection)"
          style={{
            left: Math.round(hover.line.x),
            top: Math.round(hover.line.y) - 1,
            width: Math.round(hover.line.width),
            height: 2,
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

/**
 * {@link DocumentEmbedSpot} under a screen point: over the body of a
 * Document on the canvas, the gap between its blocks nearest the pointer. The
 * topmost Document wins where two overlap.
 */
export function documentEmbedSpotAt(
  clientX: number,
  clientY: number,
  editorOf: (documentId: string) => Editor | undefined
): DocumentEmbedSpot | null {
  const bodies = document.querySelectorAll<HTMLElement>(
    "[data-markdown-layer] [data-markdown-layer-scroll]"
  )
  for (const body of [...bodies].reverse()) {
    const rect = body.getBoundingClientRect()
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      continue
    const documentId = body
      .closest<HTMLElement>("[data-markdown-layer]")
      ?.getAttribute("data-doc-id")
    const editor = documentId ? editorOf(documentId) : undefined
    if (!documentId || !editor) return null
    const gap = blockGapAt(
      laidOutBlocks(editor),
      editor.state.doc.content.size,
      clientY
    )
    if (!gap) return null
    // The line spans the text column, inside the body's padding.
    const column = editor.view.dom.getBoundingClientRect()
    return {
      documentId,
      pos: gap.pos,
      line: {
        left: column.left,
        top: Math.min(Math.max(gap.y, rect.top), rect.bottom),
        width: column.width,
      },
    }
  }
  return null
}
