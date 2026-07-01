"use client"

import { useEffect, useRef } from "react"
import type {
  GapHandle,
  IframeLayerLayoutMap,
  ReorderHandle,
} from "@/lib/canvas/layout"
import type { SnapGuide } from "@/lib/canvas/snap"

interface OtherSelection {
  selectedIframeLayerIds: string[]
  /** Members of groups the other user has selected. Outlined like directly-
   *  selected frames but never given resize handles — mirrors the local
   *  `groupSelectedIframeLayerIds` path. */
  groupSelectedIframeLayerIds: string[]
  color: string
  name: string
}

interface SelectionOverlayProps {
  /** Hide the overlay (e.g. during an active zoom) without unmounting, so the
   *  canvas keeps its parent-measured size and redraws instantly when shown. */
  hidden?: boolean
  zoom: number
  viewportPos: { x: number; y: number }
  selectedIframeLayerIds: Set<string>
  /** IframeLayers highlighted because their parent group is selected. No resize handles. */
  groupSelectedIframeLayerIds: Set<string>
  focusedIframeLayerId: string | null
  hoveredIframeLayerId: string | null
  iframeLayerLayouts: IframeLayerLayoutMap
  marquee: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  frameDraft: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  documentDraft: {
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null
  othersSelections: OtherSelection[]
  hideResizeHandles?: boolean
  inspectRect?: { x: number; y: number; width: number; height: number } | null
  /**
   * Sky-blue outline for the element a hovered composer / message element token
   * references (PRD #616). Drawn on this overlay canvas — not as a box inside the
   * iframe — so its stroke stays a constant 1px at any zoom, matching the
   * inspect / selection rects.
   */
  highlightRect?: { x: number; y: number; width: number; height: number } | null
  /**
   * One handle per inter-iframeLayer gap in selected groups, as produced by the
   * `lib/canvas/layout` module. World-space `centerX` is the gap's midpoint;
   * `top`/`bottom` clamp the handle to the shared height of the two adjacent
   * iframeLayers. Drawn at constant screen-pixel size so the grab target
   * doesn't change with zoom.
   */
  gapHandles?: GapHandle[]
  /**
   * One reorder handle per iframeLayer in a selected multi-iframeLayer group,
   * as produced by the `lib/canvas/layout` module. The world-space center is
   * projected to screen and drawn as a small dot at constant pixel size.
   * Pressing one starts a drag that reorders the iframeLayers in the group.
   */
  reorderHandles?: ReorderHandle[]
  /** When the cursor is over a reorder dot, render that one filled instead of hollow. */
  hoveredReorderIframeLayerId?: string | null
  /**
   * World-space shift applied to the lifted iframeLayer's frame outline and its
   * reorder dot during a reorder drag — keeps the overlay aligned with the
   * translated iframeLayer DOM element.
   */
  reorderDragShift?: { iframeLayerId: string; dx: number; dy: number } | null
  /**
   * Active edge/center snap guides for the current move drag. World-space
   * axis-aligned segments — projected to screen and drawn at 1px red. Empty
   * when no drag is in progress.
   */
  snapGuides?: SnapGuide[]
  /**
   * True while the active corner/edge resize is locked onto a device preset.
   * The single selected iframeLayer is already patched to the snapped size, so
   * its selection rect + handles turn red to signal the lock (replacing the
   * separate snapped ghost the ResizeSnapUnderlay used to draw).
   */
  isResizeSnapped?: boolean
}

function resolveColor(
  el: HTMLElement,
  varName: string,
  fallback: string
): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const temp = document.createElement("div")
  temp.style.color = raw
  document.body.appendChild(temp)
  const resolved = getComputedStyle(temp).color
  document.body.removeChild(temp)
  return resolved
}

export function SelectionOverlay({
  hidden,
  zoom,
  viewportPos,
  selectedIframeLayerIds,
  groupSelectedIframeLayerIds,
  focusedIframeLayerId,
  hoveredIframeLayerId,
  iframeLayerLayouts,
  marquee,
  frameDraft,
  documentDraft,
  othersSelections,
  hideResizeHandles,
  inspectRect,
  highlightRect,
  gapHandles,
  reorderHandles,
  hoveredReorderIframeLayerId,
  reorderDragShift,
  snapGuides,
  isResizeSnapped,
}: SelectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    const primaryColor = "#d946ef" // tailwind fuchsia-500
    // While snapped to a device preset, the selection rect + handles go red.
    const selectionColor = isResizeSnapped ? "#ef4444" : primaryColor
    const bgColor = resolveColor(canvas, "--background", "#fff")
    const HANDLE_SIZE = 8

    const toScreen = (x: number, y: number) => ({
      x: x * zoom + viewportPos.x,
      y: y * zoom + viewportPos.y,
    })
    // Snap to device-pixel boundaries (not CSS pixels) so 1px strokes stay
    // crisp on retina while still moving smoothly when the viewport pans
    // sub-CSS-pixel amounts. Rounding to whole CSS pixels would produce
    // visible 1px jitter as the viewport position crosses each integer.
    const snap = (v: number) => Math.round(v * dpr) / dpr
    // Offset to put a 1px stroke between two device pixels.
    const HALF = 0.5 / dpr

    // Outside-stroke convention shared by every selection rect: the 1px line
    // sits just outside the snapped world-space bounds.
    const strokeWorldRect = (l: number, t: number, r: number, b: number) => {
      ctx.strokeRect(l - HALF, t - HALF, r - l + 2 * HALF, b - t + 2 * HALF)
    }
    // Union bounding rect spanning the given iframeLayer ids. Used by both the
    // local multi-selection and remote users' multi-selections so they render
    // identically.
    const strokeUnionRect = (ids: Iterable<string>) => {
      let uLeft = Infinity,
        uTop = Infinity,
        uRight = -Infinity,
        uBottom = -Infinity
      for (const id of ids) {
        const layout = iframeLayerLayouts.get(id)
        if (!layout) continue
        uLeft = Math.min(uLeft, layout.x)
        uTop = Math.min(uTop, layout.y)
        uRight = Math.max(uRight, layout.x + layout.width)
        uBottom = Math.max(uBottom, layout.y + layout.height)
      }
      if (uLeft === Infinity) return
      const tl = toScreen(uLeft, uTop)
      const br = toScreen(uRight, uBottom)
      strokeWorldRect(snap(tl.x), snap(tl.y), snap(br.x), snap(br.y))
    }

    // Draw hover frame (only if not already selected/focused)
    if (
      hoveredIframeLayerId &&
      !selectedIframeLayerIds.has(hoveredIframeLayerId) &&
      focusedIframeLayerId !== hoveredIframeLayerId
    ) {
      const layout = iframeLayerLayouts.get(hoveredIframeLayerId)
      if (layout) {
        const tl = toScreen(layout.x, layout.y)
        const br = toScreen(layout.x + layout.width, layout.y + layout.height)
        const l = snap(tl.x)
        const t = snap(tl.y)
        const r = snap(br.x)
        const b = snap(br.y)
        ctx.globalAlpha = 0.4
        ctx.strokeStyle = primaryColor
        ctx.lineWidth = 1
        strokeWorldRect(l, t, r, b)
        ctx.globalAlpha = 1
      }
    }

    // Draw other users' selections — same per-frame outlines + multi-selection
    // union rect as the local selection, just without resize handles. Group
    // members are outlined alongside directly-selected frames. The union spans
    // both sets and (matching the local rule) appears only when there's more
    // than one directly-selected frame, or at least one directly-selected
    // frame plus a selected group. A lone group selection shows just its
    // member outlines, no enclosing union.
    const strokeOutline = (id: string) => {
      const layout = iframeLayerLayouts.get(id)
      if (!layout) return false
      const tl = toScreen(layout.x, layout.y)
      const br = toScreen(layout.x + layout.width, layout.y + layout.height)
      strokeWorldRect(snap(tl.x), snap(tl.y), snap(br.x), snap(br.y))
      return true
    }
    for (const other of othersSelections) {
      const directIds = other.selectedIframeLayerIds
      const groupIds = other.groupSelectedIframeLayerIds
      if (directIds.length === 0 && groupIds.length === 0) continue
      ctx.strokeStyle = other.color
      ctx.lineWidth = 1
      let directDrawn = 0
      for (const id of directIds) if (strokeOutline(id)) directDrawn++
      let groupDrawn = 0
      for (const id of groupIds) if (strokeOutline(id)) groupDrawn++
      if (directDrawn > 1 || (directDrawn >= 1 && groupDrawn > 0)) {
        strokeUnionRect([...directIds, ...groupIds])
      }
    }

    // Compute rounded frame edges for selected/focused/group-selected iframeLayers
    const frameEdges = new Map<
      string,
      { l: number; t: number; r: number; b: number }
    >()
    for (const layout of iframeLayerLayouts.values()) {
      const inDirect = selectedIframeLayerIds.has(layout.id)
      const inGroup = groupSelectedIframeLayerIds.has(layout.id)
      if (!inDirect && !inGroup && focusedIframeLayerId !== layout.id) continue
      // Lifted iframeLayer's outline tracks its translated DOM position.
      const shift =
        reorderDragShift && reorderDragShift.iframeLayerId === layout.id
          ? reorderDragShift
          : null
      const ox = shift ? shift.dx : 0
      const oy = shift ? shift.dy : 0
      const tl = toScreen(layout.x + ox, layout.y + oy)
      const br = toScreen(
        layout.x + layout.width + ox,
        layout.y + layout.height + oy
      )
      frameEdges.set(layout.id, {
        l: snap(tl.x),
        t: snap(tl.y),
        r: snap(br.x),
        b: snap(br.y),
      })
    }

    // Draw selection frames for iframeLayers
    ctx.strokeStyle = selectionColor
    ctx.lineWidth = 1
    for (const { l, t, r, b } of frameEdges.values()) {
      strokeWorldRect(l, t, r, b)
    }

    // Draw resize handles for single iframeLayer selection
    const totalSelected = selectedIframeLayerIds.size
    if (
      selectedIframeLayerIds.size === 1 &&
      totalSelected === 1 &&
      !hideResizeHandles
    ) {
      const id = selectedIframeLayerIds.values().next().value as string
      const edges = frameEdges.get(id)
      if (edges) {
        const { l, t, r, b } = edges
        const mx = snap((l + r) / 2)
        const my = snap((t + b) / 2)
        const hs = HANDLE_SIZE
        const hh = hs / 2

        const handles = [
          [l, t],
          [r, t],
          [l, b],
          [r, b],
          [mx, t],
          [mx, b],
          [l, my],
          [r, my],
        ]
        for (const [hx, hy] of handles) {
          ctx.fillStyle = bgColor
          ctx.fillRect(hx - hh, hy - hh, hs, hs)
          ctx.strokeStyle = selectionColor
          ctx.lineWidth = 1
          ctx.strokeRect(
            hx - hh + HALF,
            hy - hh + HALF,
            hs - 2 * HALF,
            hs - 2 * HALF
          )
        }
      }
    }

    // Draw union bounding rect across a multi-selection. Spans every
    // individually-selected frame/doc *and* every member of a selected group,
    // so a mixed group-plus-frame selection gets one rect around the whole set.
    // A lone group selection (no individually-selected members) shows no union
    // — each selected group already outlines its own members.
    const showUnion =
      totalSelected > 1 ||
      (totalSelected >= 1 && groupSelectedIframeLayerIds.size > 0)
    if (showUnion) {
      const unionIds = new Set<string>(selectedIframeLayerIds)
      for (const id of groupSelectedIframeLayerIds) unionIds.add(id)
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      strokeUnionRect(unionIds)
    }

    // Draw inspect rect (hovered or picked element)
    if (inspectRect) {
      const tl = toScreen(inspectRect.x, inspectRect.y)
      const br = toScreen(
        inspectRect.x + inspectRect.width,
        inspectRect.y + inspectRect.height
      )
      const l = snap(tl.x)
      const t = snap(tl.y)
      const r = snap(br.x)
      const b = snap(br.y)
      ctx.globalAlpha = 0.1
      ctx.fillStyle = "#3b82f6"
      ctx.fillRect(l, t, r - l, b - t)
      ctx.globalAlpha = 1
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 1
      // Inside stroke: inset by HALF so the 1px line sits entirely within the bounds
      ctx.strokeRect(l + HALF, t + HALF, r - l - 2 * HALF, b - t - 2 * HALF)
    }

    // Draw the token-hover highlight rect. Same screen-space projection and
    // constant-1px inside stroke as the inspect rect, tinted sky-blue to match
    // the composer token.
    if (highlightRect) {
      const tl = toScreen(highlightRect.x, highlightRect.y)
      const br = toScreen(
        highlightRect.x + highlightRect.width,
        highlightRect.y + highlightRect.height
      )
      const l = snap(tl.x)
      const t = snap(tl.y)
      const r = snap(br.x)
      const b = snap(br.y)
      ctx.globalAlpha = 0.1
      ctx.fillStyle = "#0ea5e9"
      ctx.fillRect(l, t, r - l, b - t)
      ctx.globalAlpha = 1
      ctx.strokeStyle = "#0ea5e9"
      ctx.lineWidth = 1
      ctx.strokeRect(l + HALF, t + HALF, r - l - 2 * HALF, b - t - 2 * HALF)
    }

    // Draw marquee rectangle
    if (marquee) {
      // Convert both corners to screen space, then snap edges independently
      const a = toScreen(marquee.startX, marquee.startY)
      const b = toScreen(marquee.currentX, marquee.currentY)
      const l = snap(Math.min(a.x, b.x))
      const t = snap(Math.min(a.y, b.y))
      const r = snap(Math.max(a.x, b.x))
      const bo = snap(Math.max(a.y, b.y))

      ctx.globalAlpha = 0.1
      ctx.fillStyle = primaryColor
      ctx.fillRect(l, t, r - l, bo - t)

      ctx.globalAlpha = 1
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + HALF, t + HALF, r - l, bo - t)
    }

    // Draw reorder handles — matches symaphore's CompositionHandle. Both
    // states are 12×12 outer (1px white) with a 1px primary ring at 10×10.
    // The 8×8 center is hollow by default (group:hover state — transparent
    // center with 1px white inset) and filled when the cursor is over the
    // dot (handle:hover inherits 8×8 from group:hover, only swapping the bg
    // back to primary).
    if (reorderHandles && reorderHandles.length > 0) {
      for (const h of reorderHandles) {
        const shift =
          reorderDragShift && reorderDragShift.iframeLayerId === h.iframeLayerId
            ? reorderDragShift
            : null
        const ox = shift ? shift.dx : 0
        const oy = shift ? shift.dy : 0
        const center = toScreen(h.centerX + ox, h.centerY + oy)
        const cx = snap(center.x) + HALF
        const cy = snap(center.y) + HALF
        const filled = h.iframeLayerId === hoveredReorderIframeLayerId
        // 12×12 outer white
        ctx.beginPath()
        ctx.arc(cx, cy, 6, 0, Math.PI * 2)
        ctx.fillStyle = bgColor
        ctx.fill()
        // 10×10 primary (1px ring outside the 8×8)
        ctx.beginPath()
        ctx.arc(cx, cy, 5, 0, Math.PI * 2)
        ctx.fillStyle = primaryColor
        ctx.fill()
        if (filled) {
          // Hovered: leave the 8×8 center filled primary — no further draw needed.
        } else {
          // Default: 1px white inset around an 8×8 transparent center.
          ctx.beginPath()
          ctx.arc(cx, cy, 4, 0, Math.PI * 2)
          ctx.fillStyle = bgColor
          ctx.fill()
          ctx.save()
          ctx.beginPath()
          ctx.arc(cx, cy, 3, 0, Math.PI * 2)
          ctx.globalCompositeOperation = "destination-out"
          ctx.fill()
          ctx.restore()
        }
      }
    }

    // Draw gap-resize handles for selected groups. Matches symaphore's
    // GapHandle: a 1×12 primary-color line with a 1px bg-color outline.
    // Constant screen-pixel size since it lives on the screen-space overlay.
    if (gapHandles && gapHandles.length > 0) {
      const HH = 12
      for (const h of gapHandles) {
        const center = toScreen(h.centerX, (h.top + h.bottom) / 2)
        const cy = snap(center.y)
        const halfH = Math.min(HH / 2, ((h.bottom - h.top) * zoom) / 2)
        // Translate to the exact gap midpoint and draw symmetrically. We
        // intentionally don't round the X here: rounding snaps the 1px line
        // ±1px from the visual gap center when centerX lands near a
        // half-pixel, which reads as the handle being off from the gap.
        ctx.save()
        ctx.translate(center.x, cy)
        ctx.fillStyle = bgColor
        ctx.fillRect(-1.5, -halfH - 1, 3, halfH * 2 + 2)
        ctx.fillStyle = primaryColor
        ctx.fillRect(-0.5, -halfH, 1, halfH * 2)
        ctx.restore()
      }
    }

    // Draw frame-draft rectangle (while dragging with the frame tool)
    if (frameDraft) {
      const a = toScreen(frameDraft.startX, frameDraft.startY)
      const b = toScreen(frameDraft.currentX, frameDraft.currentY)
      const l = snap(Math.min(a.x, b.x))
      const t = snap(Math.min(a.y, b.y))
      const r = snap(Math.max(a.x, b.x))
      const bo = snap(Math.max(a.y, b.y))

      ctx.globalAlpha = 1
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + HALF, t + HALF, r - l, bo - t)
      ctx.setLineDash([])
    }

    // Draw document-draft rectangle (while dragging with the document tool)
    if (documentDraft) {
      const a = toScreen(documentDraft.startX, documentDraft.startY)
      const b = toScreen(documentDraft.currentX, documentDraft.currentY)
      const l = snap(Math.min(a.x, b.x))
      const t = snap(Math.min(a.y, b.y))
      const r = snap(Math.max(a.x, b.x))
      const bo = snap(Math.max(a.y, b.y))

      ctx.globalAlpha = 1
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = primaryColor
      ctx.lineWidth = 1
      ctx.strokeRect(l + HALF, t + HALF, r - l, bo - t)
      ctx.setLineDash([])
    }

    // Edge/center snap guides — 1px red lines anchored to the snapped world
    // coord. The pixel offset matches the selection-rect's outside-stroke
    // convention so the guide visually lies on top of the matching edge
    // strokes instead of one device pixel inside.
    //
    //   selection rect left edge:  path at snap(X) - HALF  → pixel at snap(X) - 1
    //   selection rect right edge: path at snap(X) + HALF  → pixel at snap(X)
    //
    // sourceKind tells us which side of the dragged rect drove the snap; we
    // mirror that offset so e.g. left-to-left alignments overlap and "look
    // like one stroke." `mid` has no corresponding rect edge — default to the
    // +HALF side for consistency.
    //
    // Subpixel precision on the perpendicular axis is preserved (no Math.round
    // on the endpoints) so the line tracks the world coord exactly as the
    // camera pans, without jitter.
    if (snapGuides && snapGuides.length > 0) {
      const guideColor = "#ef4444" // tailwind red-500
      const X_ARM = 3 // half-extent of × markers in screen px
      ctx.strokeStyle = guideColor
      ctx.lineWidth = 1

      ctx.beginPath()
      for (const g of snapGuides) {
        const offset = g.sourceKind === "min" ? -HALF : HALF
        let start = Infinity
        let end = -Infinity
        for (const [a, b] of g.marks) {
          if (a < start) start = a
          if (b > end) end = b
        }
        if (g.axis === "x") {
          const screenX = snap(g.pos * zoom + viewportPos.x) + offset
          const y1 = start * zoom + viewportPos.y
          const y2 = end * zoom + viewportPos.y
          ctx.moveTo(screenX, y1)
          ctx.lineTo(screenX, y2)
        } else {
          const screenY = snap(g.pos * zoom + viewportPos.y) + offset
          const x1 = start * zoom + viewportPos.x
          const x2 = end * zoom + viewportPos.x
          ctx.moveTo(x1, screenY)
          ctx.lineTo(x2, screenY)
        }
      }
      ctx.stroke()

      // × end-markers — one per rect endpoint on each guide. Centered exactly
      // on the rect corner so the × visually "pins" each participating rect
      // to the alignment line.
      ctx.beginPath()
      for (const g of snapGuides) {
        const offset = g.sourceKind === "min" ? -HALF : HALF
        if (g.axis === "x") {
          const screenX = snap(g.pos * zoom + viewportPos.x) + offset
          for (const [a, b] of g.marks) {
            const ya = a * zoom + viewportPos.y
            const yb = b * zoom + viewportPos.y
            ctx.moveTo(screenX - X_ARM, ya - X_ARM)
            ctx.lineTo(screenX + X_ARM, ya + X_ARM)
            ctx.moveTo(screenX + X_ARM, ya - X_ARM)
            ctx.lineTo(screenX - X_ARM, ya + X_ARM)
            ctx.moveTo(screenX - X_ARM, yb - X_ARM)
            ctx.lineTo(screenX + X_ARM, yb + X_ARM)
            ctx.moveTo(screenX + X_ARM, yb - X_ARM)
            ctx.lineTo(screenX - X_ARM, yb + X_ARM)
          }
        } else {
          const screenY = snap(g.pos * zoom + viewportPos.y) + offset
          for (const [a, b] of g.marks) {
            const xa = a * zoom + viewportPos.x
            const xb = b * zoom + viewportPos.x
            ctx.moveTo(xa - X_ARM, screenY - X_ARM)
            ctx.lineTo(xa + X_ARM, screenY + X_ARM)
            ctx.moveTo(xa + X_ARM, screenY - X_ARM)
            ctx.lineTo(xa - X_ARM, screenY + X_ARM)
            ctx.moveTo(xb - X_ARM, screenY - X_ARM)
            ctx.lineTo(xb + X_ARM, screenY + X_ARM)
            ctx.moveTo(xb + X_ARM, screenY - X_ARM)
            ctx.lineTo(xb - X_ARM, screenY + X_ARM)
          }
        }
      }
      ctx.stroke()
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [
    zoom,
    viewportPos,
    selectedIframeLayerIds,
    groupSelectedIframeLayerIds,
    focusedIframeLayerId,
    hoveredIframeLayerId,
    iframeLayerLayouts,
    marquee,
    frameDraft,
    documentDraft,
    othersSelections,
    hideResizeHandles,
    inspectRect,
    highlightRect,
    gapHandles,
    reorderHandles,
    hoveredReorderIframeLayerId,
    reorderDragShift,
    snapGuides,
    isResizeSnapped,
  ])

  // Keep canvas sized to container
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const parent = canvas.parentElement
    if (!parent) return

    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      const r = parent.getBoundingClientRect()
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
      canvas.style.width = `${r.width}px`
      canvas.style.height = `${r.height}px`
    })

    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10"
      style={hidden ? { visibility: "hidden" } : undefined}
    />
  )
}
