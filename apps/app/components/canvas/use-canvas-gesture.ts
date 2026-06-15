import {
  useCallback,
  useRef,
  useState,
  type RefObject,
} from "react"
import {
  EMPTY_PREVIEW,
  reduceGesture,
  type GestureEvent,
  type GestureIntent,
  type GesturePreview,
  type GestureState,
} from "@/lib/canvas/gesture"
import type { GapHandle, ReorderHandle } from "@/lib/canvas/layout"
import {
  hitTestMarquee,
  hitTestReorderHandle,
  routePointerToGesture,
  screenToCanvas,
  type CanvasTransform,
  type MarqueeLayout,
  type RouteGroup,
} from "@/lib/canvas/route"

/**
 * The draw-tool drafts (document / frame mode) that share the canvas root's
 * pointer handlers with the gestures but are *not* gestures — they create a
 * layer rather than reducing through the Gesture FSM. The hook owns the handler
 * ordering (drafts are checked after reorder/gap, before marquee) and delegates
 * the draft domain logic (default sizes, layer creation, selection) back to the
 * component through these callbacks.
 */
export type CanvasDrawTool = {
  /** Begin a draft at the canvas-space point (component sets its draft ref). */
  beginDraft: (canvas: { x: number; y: number }) => void
  /** Track a live draft; returns `true` when one was active (and updated). */
  updateDraft: (canvas: { x: number; y: number }) => boolean
  /** Commit a live draft; returns `true` when one was active (and committed). */
  commitDraft: () => boolean
}

/**
 * Everything the gesture seam needs to turn a raw pointer event into a
 * {@link GestureEvent} and apply the result. The component supplies plain
 * snapshots (the Canvas Layout geometry, the handle geometry, the
 * interaction-mode flags, the base selection) plus the Canvas Operations the
 * Intent is applied through; the routing decision itself is the pure
 * `routePointerToGesture`.
 *
 * Passed via a ref the component repopulates every render: the hook is created
 * high in the component (its `dispatch`/`preview` feed `deriveCanvasLayout`),
 * but most inputs — the derived handle geometry, the draw-tool drafts — are
 * defined further down, so a ref breaks the ordering cycle exactly as the old
 * `gapHandlesRef`/`reorderHandlesRef` did.
 */
export type CanvasGestureInputs = {
  /** Apply an emitted Gesture Intent through the Canvas Operations / selection
   *  setters (canvas-mutating intents write the Y.Doc; `marqueeSelect` /
   *  `selectMember` apply to local selection state). */
  applyIntent: (intent: GestureIntent) => void
  /** Live pan/zoom transform, or `null` before the controller mounts. */
  getTransform: () => CanvasTransform | null
  /** Current zoom — hit-test radii are evaluated in screen pixels. */
  zoom: number

  // Interaction-mode flags — any active mode suppresses gesture routing.
  spaceHeld: boolean
  focusedLayer: boolean
  commentMode: boolean
  documentMode: boolean
  frameMode: boolean

  /** Live reorder-dot / gap-handle geometry (from the Canvas Layout). */
  reorderHandles: readonly ReorderHandle[]
  gapHandles: readonly GapHandle[]

  /** Plain group snapshots the reorder/gap context is assembled from. */
  groups: readonly RouteGroup[]
  /** Member top-left layouts (for the reorder grab offset). */
  memberLayouts: ReadonlyMap<string, { x: number; y: number }>
  /** Every layer's world rect (for the marquee hit-test). */
  marqueeLayouts: ReadonlyMap<string, MarqueeLayout>
  /** Markdown-layer ids (so the marquee hit-test classifies document hits). */
  markdownLayerIds: ReadonlySet<string>
  /** Selection frozen into a marquee start's base. */
  baseIframeLayerIds: ReadonlySet<string>
  baseDocumentLayerIds: ReadonlySet<string>

  /** Draw-tool drafts that share the pointer handlers (document / frame mode). */
  drawTool: CanvasDrawTool

  /** Re-hit-test the reorder dot at the release point so it drops back to its
   *  hollow state when the cursor isn't over it. */
  onReorderReleaseHover: (hit: ReorderHandle | null) => void
}

/** True while a mode suppresses all gesture routing. */
const isSuppressed = (i: CanvasGestureInputs) =>
  i.spaceHeld ||
  i.focusedLayer ||
  i.commentMode ||
  i.documentMode ||
  i.frameMode

/** Canvas-space point of a pointer event against the wrapper, or `null`. */
function toCanvas(i: CanvasGestureInputs, e: React.PointerEvent) {
  const transform = i.getTransform()
  if (!transform) return null
  const rect = e.currentTarget.getBoundingClientRect()
  return screenToCanvas(e.clientX, e.clientY, rect, transform)
}

/**
 * The Canvas Gesture seam — the one place gesture I/O lives. It owns the gesture
 * state ref and the canvas-root pointer handlers (returned in {@link handlers}
 * to spread onto the wrapper), routes a pointer-down through the pure
 * `routePointerToGesture`, reduces every pointer/key event through
 * `reduceGesture`, exposes the {@link GesturePreview} for `deriveCanvasLayout`
 * and the overlays, and applies the emitted {@link GestureIntent}s via the
 * Canvas Operations passed in. The component supplies the inputs the routing
 * needs and stops defining its own pointer handlers.
 *
 * The state lives in a ref (read synchronously by the handlers without
 * re-binding); the preview lives in state so a `move` re-renders the canvas and
 * the in-flight layout reflows. All the geometry/decision logic is pure
 * (`lib/canvas/route`, `lib/canvas/gesture`); this hook is wiring — it never
 * computes geometry and never touches the Y.Doc itself.
 */
export function useCanvasGesture(
  inputsRef: RefObject<CanvasGestureInputs | null>
) {
  const stateRef = useRef<GestureState>({ kind: "idle" })
  const [preview, setPreview] = useState<GesturePreview>(EMPTY_PREVIEW)

  const dispatch = useCallback(
    (event: GestureEvent) => {
      const result = reduceGesture(stateRef.current, event)
      stateRef.current = result.state
      setPreview(result.preview)
      if (result.intent) inputsRef.current?.applyIntent(result.intent)
    },
    [inputsRef]
  )

  /** Current FSM state — read by the handlers (and the component) to route. */
  const getState = useCallback(() => stateRef.current, [])

  /**
   * Capture-phase: the reorder dot and gap handle sit over a member, so they
   * must claim the pointer before the member's own overlay (which captures it
   * and `stopPropagation`s). Routes only reorder/gap.
   */
  const onPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      const i = inputsRef.current
      if (!i) return
      if (e.button !== 0 || i.spaceHeld || i.focusedLayer) return
      if (i.commentMode || i.documentMode || i.frameMode) return
      const target = e.target as HTMLElement
      if (!e.currentTarget.contains(target)) return
      // Top window-drag strip: defer to Tauri's native window drag.
      if (target.closest("[data-tauri-drag-region]")) return

      const canvas = toCanvas(i, e)
      if (!canvas) return

      const start = routePointerToGesture({
        canvas,
        zoom: i.zoom,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        suppressed: isSuppressed(i),
        phase: { reorderGap: true, marquee: false },
        reorderHandles: i.reorderHandles,
        gapHandles: i.gapHandles,
        groups: i.groups,
        memberLayouts: i.memberLayouts,
        baseIframeLayerIds: i.baseIframeLayerIds,
        baseDocumentLayerIds: i.baseDocumentLayerIds,
      })
      if (!start) return

      dispatch({ type: "start", start })
      e.currentTarget.setPointerCapture(e.pointerId)
      e.stopPropagation()
      e.preventDefault()
    },
    [inputsRef, dispatch]
  )

  /**
   * Bubble-phase: a press on empty canvas starts a draw-tool draft (document /
   * frame mode) or a marquee. Reorder/gap have already been claimed in capture.
   */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const i = inputsRef.current
      if (!i) return
      if (e.button !== 0 || i.spaceHeld || i.focusedLayer) return
      const target = e.target as HTMLElement
      // React forwards events from portaled children (dropdowns, dialogs,
      // popovers) through the tree even though the DOM target lives on
      // document.body — ignore those so we don't swallow the child's click.
      if (!e.currentTarget.contains(target)) return
      // Gap drag has already been claimed by the capture handler.
      if (stateRef.current.kind === "gap") return

      if (
        target.closest("[data-iframe-layer]") ||
        target.closest("[data-markdown-layer]") ||
        target.closest("button") ||
        target.closest("a") ||
        // Top window-drag strip: let Tauri start a native window drag.
        target.closest("[data-tauri-drag-region]")
      )
        return

      // Draw-tool drafts (document / frame mode): begin a draft rectangle. The
      // domain logic lives in the component; the hook owns the ordering.
      if (i.documentMode || i.frameMode) {
        const canvas = toCanvas(i, e)
        if (!canvas) return
        i.drawTool.beginDraft(canvas)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }

      if (i.commentMode) return
      // Ignore clicks near the left/right edges so resize-handle grabs don't
      // start a marquee.
      const wrapperRect = e.currentTarget.getBoundingClientRect()
      if (e.clientX - wrapperRect.left < 8 || wrapperRect.right - e.clientX < 8)
        return

      const canvas = toCanvas(i, e)
      if (!canvas) return
      const start = routePointerToGesture({
        canvas,
        zoom: i.zoom,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        suppressed: isSuppressed(i),
        phase: { reorderGap: false, marquee: true },
        reorderHandles: i.reorderHandles,
        gapHandles: i.gapHandles,
        groups: i.groups,
        memberLayouts: i.memberLayouts,
        baseIframeLayerIds: i.baseIframeLayerIds,
        baseDocumentLayerIds: i.baseDocumentLayerIds,
      })
      if (!start) return
      dispatch({ type: "start", start })
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [inputsRef, dispatch]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const i = inputsRef.current
      if (!i) return
      const state = stateRef.current

      // Reorder drag: feed the live cursor + meta state to the FSM.
      if (state.kind === "reorder") {
        const canvas = toCanvas(i, e)
        if (!canvas) return
        dispatch({ type: "move", cursor: canvas, meta: e.metaKey })
        return
      }

      // Gap-handle drag: feed the live cursor; the reducer previews the new gap.
      if (state.kind === "gap") {
        const canvas = toCanvas(i, e)
        if (!canvas) return
        dispatch({ type: "move", cursor: canvas })
        return
      }

      // Draw-tool draft tracking (document / frame mode).
      const draftCanvas = toCanvas(i, e)
      if (draftCanvas && i.drawTool.updateDraft(draftCanvas)) return

      // Marquee drag: hit-test the live rect against the layouts (the geometry
      // the FSM never touches) and feed the covered layers in.
      if (state.kind === "marquee") {
        if (!draftCanvas) return
        const { startX, startY } = state.ctx
        const rect = {
          left: Math.min(startX, draftCanvas.x),
          top: Math.min(startY, draftCanvas.y),
          right: Math.max(startX, draftCanvas.x),
          bottom: Math.max(startY, draftCanvas.y),
        }
        const hits = hitTestMarquee(
          rect,
          i.marqueeLayouts.values(),
          i.markdownLayerIds
        )
        dispatch({ type: "move", cursor: draftCanvas, hits })
        return
      }
    },
    [inputsRef, dispatch]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const i = inputsRef.current
      if (!i) return
      const state = stateRef.current

      // Reorder release: the FSM decides the commit (live `reorderMember`,
      // meta-held `popOutToNewGroup`, or no-move `selectMember`). Re-hit-test at
      // the release point so the dot drops back to its hollow state.
      if (state.kind === "reorder") {
        const canvas = toCanvas(i, e)
        if (!canvas) return
        dispatch({ type: "release", cursor: canvas, meta: e.metaKey })
        const hit = hitTestReorderHandle(
          i.reorderHandles,
          canvas.x,
          canvas.y,
          i.zoom
        )
        i.onReorderReleaseHover(hit)
        return
      }

      // Gap release: commit the previewed gap via the `setGroupGap` intent.
      if (state.kind === "gap") {
        dispatch({ type: "release" })
        return
      }

      // Draw-tool draft release: create the layer (component domain logic).
      if (i.drawTool.commitDraft()) return

      // Marquee release: the FSM decides — a real drag keeps the settled
      // selection; a tiny drag deselects (the click rule lives in the reducer).
      if (state.kind === "marquee") {
        dispatch({ type: "release" })
        return
      }
    },
    [inputsRef, dispatch]
  )

  return {
    preview,
    dispatch,
    getState,
    handlers: {
      onPointerDownCapture,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
  }
}
