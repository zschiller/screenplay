/**
 * Canvas Gesture — the **pointer→gesture adapter**, the input edge of the
 * triad **derive → gesture → commit** (`reduceGesture` is the decision core in
 * `lib/canvas/gesture.ts`; this is the routing that feeds it).
 *
 * `routePointerToGesture` is a pure, React-free, Yjs-free, DOM-free decision:
 * given a pointer-down position in canvas space, the live reorder/gap handle
 * geometry, the active interaction-mode flags, and the plain group/layout
 * snapshots the gesture-start context is assembled from, it returns the
 * {@link GestureStart} to dispatch (a `start` of kind `reorder` / `gap` /
 * `marquee`) or `null`. The sibling of `reduceGesture`, `computeMoveSnap`, and
 * `deriveCanvasLayout`: same inputs always produce the same start, so "which
 * gesture does this pointer-down begin" is asserted against plain values rather
 * than through React and a live pointer.
 *
 * `screenToCanvas`, `hitTestReorderHandle`, and `hitTestGapHandle` move here
 * with the routing — the coordinate and hit math sits next to the decision that
 * consumes it. The hook (`use-canvas-gesture.ts`) owns the DOM-side wiring
 * (event attachment, pointer capture, `stopPropagation`); it converts the raw
 * pointer event into these plain inputs, calls the router, and dispatches the
 * result into `reduceGesture`.
 */

import type {
  GapGestureContext,
  GestureStart,
  MarqueeHits,
  MarqueeGestureContext,
  ReorderGestureContext,
  ReorderMemberSnapshot,
} from "@/lib/canvas/gesture"
import type { GapHandle, ReorderHandle } from "@/lib/canvas/layout"

/** Live transform read from the pan/zoom controller. */
export type CanvasTransform = {
  positionX: number
  positionY: number
  scale: number
}

/**
 * Convert a screen-space client point to canvas (world) space. Pure given the
 * wrapper rect and the live transform — the inverse of the pan/zoom matrix the
 * canvas paints with.
 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  transform: CanvasTransform
): { x: number; y: number } {
  const { positionX, positionY, scale } = transform
  return {
    x: (clientX - rect.left - positionX) / scale,
    y: (clientY - rect.top - positionY) / scale,
  }
}

/**
 * Hit-test the reorder dots in screen-space — the visual is 12px across at any
 * zoom, with an 8px (screen) pad so it stays grabbable at the edges. Returns
 * the first handle whose center is within the padded radius of the cursor, or
 * `null`.
 */
export function hitTestReorderHandle(
  handles: readonly ReorderHandle[],
  canvasX: number,
  canvasY: number,
  zoom: number
): ReorderHandle | null {
  const radiusCanvas = 8 / zoom
  for (const h of handles) {
    const dx = canvasX - h.centerX
    const dy = canvasY - h.centerY
    if (dx * dx + dy * dy <= radiusCanvas * radiusCanvas) return h
  }
  return null
}

/**
 * World-space hit test against the entire gap area between two members — a 6px
 * (screen) horizontal pad keeps the handle grabbable when the gap has collapsed
 * to 0. Returns the first gap handle covering the cursor, or `null`.
 */
export function hitTestGapHandle(
  handles: readonly GapHandle[],
  canvasX: number,
  canvasY: number,
  zoom: number
): GapHandle | null {
  const padCanvas = 6 / zoom
  for (const h of handles) {
    if (canvasY < h.top || canvasY > h.bottom) continue
    if (canvasX < h.left - padCanvas || canvasX > h.right + padCanvas) continue
    return h
  }
  return null
}

/** A layer's world-space rect for the marquee hit-test. */
export type MarqueeLayout = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * The layers a marquee rect (canvas space) currently covers. Every layout in
 * the map is an `iframeLayer` hit (frames and docs share the layout map); a
 * covered layer that is also a Markdown Layer additionally counts as a document
 * hit — matching the original inline loops exactly, so a covered doc lands in
 * both sets. Pure geometry: the gesture FSM never computes this, it receives the
 * resolved id sets.
 */
export function hitTestMarquee(
  rect: { left: number; top: number; right: number; bottom: number },
  layouts: Iterable<MarqueeLayout>,
  markdownLayerIds: ReadonlySet<string>
): MarqueeHits {
  const iframeLayerIds = new Set<string>()
  const documentLayerIds = new Set<string>()
  for (const layout of layouts) {
    if (
      layout.x < rect.right &&
      layout.x + layout.width > rect.left &&
      layout.y < rect.bottom &&
      layout.y + layout.height > rect.top
    ) {
      iframeLayerIds.add(layout.id)
      if (markdownLayerIds.has(layout.id)) documentLayerIds.add(layout.id)
    }
  }
  return { iframeLayerIds, documentLayerIds }
}

/**
 * A group projected to the plain values the routing needs: its world anchor,
 * effective gap, and the per-member kind/width snapshot used for the reorder
 * order. The hook builds these from the live collections (via `groupGap` and
 * `reorderOrderSnapshot`) so the router stays Yjs-free.
 */
export type RouteGroup = {
  id: string
  /** World-space left anchor — sibling centers walk from here. */
  x: number
  /** Effective inter-member gap (the group's override, or the default). */
  gap: number
  /** Members in flow order, with the widths the reorder walk reads. */
  members: ReorderMemberSnapshot[]
}

/**
 * Assemble a reorder `start` for a grabbed member. Finds the owning group and
 * member from the plain `groups` snapshot, computes the grab offset from the
 * member's top-left layout (the popped Member stays under the exact grab spot),
 * and snapshots the order. Shared by the canvas reorder-dot path (the router)
 * and the member-label path (`requestReorderDrag`) — `selectOnNoMove`
 * distinguishes them: the dot isn't a selection affordance, the label is.
 * Returns `null` when the member isn't in any group.
 */
export function assembleReorderStart(input: {
  iframeLayerId: string
  canvas: { x: number; y: number }
  groups: readonly RouteGroup[]
  memberLayouts: ReadonlyMap<string, { x: number; y: number }>
  shiftKey: boolean
  metaKey: boolean
  selectOnNoMove: boolean
}): Extract<GestureStart, { kind: "reorder" }> | null {
  const group = input.groups.find((g) =>
    g.members.some((m) => m.id === input.iframeLayerId)
  )
  if (!group) return null
  const member = group.members.find((m) => m.id === input.iframeLayerId)
  if (!member) return null

  const layout = input.memberLayouts.get(input.iframeLayerId)
  const grabOffset = layout
    ? { x: input.canvas.x - layout.x, y: input.canvas.y - layout.y }
    : { x: 0, y: 0 }

  const ctx: ReorderGestureContext = {
    groupId: group.id,
    memberId: member.id,
    memberKind: member.kind,
    groupX: group.x,
    gap: group.gap,
    grabOffset,
    startCanvas: { x: input.canvas.x, y: input.canvas.y },
    startShiftKey: input.shiftKey,
    selectOnNoMove: input.selectOnNoMove,
  }
  return {
    kind: "reorder",
    ctx,
    order: group.members.map((m) => ({ ...m })),
    meta: input.metaKey,
  }
}

/** Which gestures a routing pass may begin — the capture phase routes the
 *  reorder dot and gap handle (they sit over a member, so they must claim the
 *  pointer before the member's own overlay), the bubble phase routes the
 *  empty-canvas marquee. */
export type RoutePhase = {
  reorderGap: boolean
  marquee: boolean
}

/**
 * Inputs for one pointer-down routing decision. All plain values — the hook
 * resolves the raw pointer event into these (canvas coords via
 * {@link screenToCanvas}, handle geometry from the layout, mode flags from the
 * interaction-mode state) before calling.
 */
export type RoutePointerInput = {
  /** Pointer-down position in canvas (world) space. */
  canvas: { x: number; y: number }
  zoom: number
  shiftKey: boolean
  metaKey: boolean
  /**
   * `true` when an interaction mode suppresses all gesture routing — space-held
   * pan, comment / document / frame mode, or a focused Iframe Layer. The one
   * place "when is a gesture suppressed" is decided.
   */
  suppressed: boolean
  /** Which gestures this pass may begin (capture vs bubble). */
  phase: RoutePhase
  reorderHandles: readonly ReorderHandle[]
  gapHandles: readonly GapHandle[]
  /** Plain group snapshots — the reorder/gap context is assembled from these. */
  groups: readonly RouteGroup[]
  /** Member top-left layouts (world space) — for the reorder grab offset. */
  memberLayouts: ReadonlyMap<string, { x: number; y: number }>
  /** Selection frozen at drag start — a shift-marquee toggles against this. */
  baseIframeLayerIds: ReadonlySet<string>
  baseDocumentLayerIds: ReadonlySet<string>
}

/**
 * Decide which gesture a pointer-down begins, or `null` for none. Precedence
 * (capture phase): a reorder-dot hit takes priority over a gap-handle hit at
 * the same point — the dot sits over the member center, so it must win. A gap
 * hit starts a `gap` gesture. In the bubble phase a press on empty canvas
 * starts a `marquee`. Every branch is gated on {@link RoutePointerInput.suppressed}
 * first, so a suppressed mode routes nothing.
 *
 * Pure: no React, no DOM, no Y.Doc. The DOM-side gating (event target checks,
 * edge margins, the document/frame draw-tool drafts) stays in the hook; this
 * sees only the resolved canvas point and the mode flags.
 */
export function routePointerToGesture(
  input: RoutePointerInput
): GestureStart | null {
  if (input.suppressed) return null

  if (input.phase.reorderGap) {
    // Reorder dots take priority — they sit over the member center, so the
    // member's own overlay would otherwise grab the pointer first.
    if (input.reorderHandles.length > 0) {
      const reorderHit = hitTestReorderHandle(
        input.reorderHandles,
        input.canvas.x,
        input.canvas.y,
        input.zoom
      )
      if (reorderHit) {
        const start = assembleReorderStart({
          iframeLayerId: reorderHit.iframeLayerId,
          canvas: input.canvas,
          groups: input.groups,
          memberLayouts: input.memberLayouts,
          shiftKey: input.shiftKey,
          metaKey: input.metaKey,
          // The dot itself isn't a selection affordance, so a no-move release
          // leaves selection untouched.
          selectOnNoMove: false,
        })
        if (start) return start
      }
    }

    if (input.gapHandles.length > 0) {
      const gapHit = hitTestGapHandle(
        input.gapHandles,
        input.canvas.x,
        input.canvas.y,
        input.zoom
      )
      if (gapHit) {
        const group = input.groups.find((g) => g.id === gapHit.groupId)
        if (group) {
          const ctx: GapGestureContext = {
            groupId: gapHit.groupId,
            gapIndex: gapHit.gapIndex,
            startGap: group.gap,
            startCanvasX: input.canvas.x,
          }
          return { kind: "gap", ctx }
        }
      }
    }
    return null
  }

  if (input.phase.marquee) {
    // A press on empty canvas opens a marquee. The DOM gating (was the press on
    // a member / button / edge margin) has already filtered the event in the
    // hook; reaching here means an empty-canvas press.
    const ctx: MarqueeGestureContext = {
      startX: input.canvas.x,
      startY: input.canvas.y,
      shiftKey: input.shiftKey,
      baseIframeLayerIds: new Set(input.baseIframeLayerIds),
      baseDocumentLayerIds: new Set(input.baseDocumentLayerIds),
    }
    return { kind: "marquee", ctx }
  }

  return null
}
