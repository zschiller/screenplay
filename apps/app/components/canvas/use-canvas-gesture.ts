import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import {
  assembleMoveStart,
  EMPTY_PREVIEW,
  reduceGesture,
  type GestureEvent,
  type GestureIntent,
  type GesturePreview,
  type GestureState,
  type MoveAssemblyGroup,
  type MoveAssemblyLayout,
} from "@/lib/canvas/gesture"
import type { GapHandle, ReorderHandle } from "@/lib/canvas/layout"
import {
  assembleReorderStart,
  hitTestGapHandle,
  hitTestMarquee,
  hitTestReorderHandle,
  routePointerToGesture,
  screenToCanvas,
  type CanvasTransform,
  type MarqueeLayout,
  type RouteGroup,
} from "@/lib/canvas/route"
import type { ResizeEdge } from "@/lib/canvas/snap"

/** The gap handle the cursor hovers/drags — drives the wrapper's col-resize
 *  cursor. Owned by the controller; the render tree reads it for the cursor. */
export type ActiveGapHandle = { groupId: string; gapIndex: number }

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
  /** Selection frozen into a marquee start's base. Equal to the live selection
   *  at populate time — also read by the Layer-initiated group-move assembly. */
  baseIframeLayerIds: ReadonlySet<string>
  baseDocumentLayerIds: ReadonlySet<string>
  /** Selected whole-group ids — the move assembly routes a selected-group drag. */
  selectedGroupIds: ReadonlySet<string>

  /** Draw-tool drafts that share the pointer handlers (document / frame mode). */
  drawTool: CanvasDrawTool

  /** The canvas wrapper element — a Layer-initiated reorder captures the pointer
   *  here so subsequent moves route through the wrapper's gesture handlers. */
  getWrapper: () => HTMLElement | null
  /** Build the move-start snapshots (groups + layouts) from the live collections
   *  at drag start — kept lazy so the projection runs once per drag, not per
   *  render. The pure `assembleMoveStart` turns these into the move `start`. */
  getMoveAssembly: () => {
    groups: readonly MoveAssemblyGroup[]
    layouts: Iterable<MoveAssemblyLayout>
  }
  /** A frame's committed size at resize start (or `null` if it vanished). */
  getIframeLayerSize: (id: string) => { width: number; height: number } | null
  /** Mark a frame dirty so the thumbnail heartbeat recaptures it after a resize. */
  markFrameDirty: (id: string) => void
  /** Clear the component's hover-highlight when a group drag begins (sweeping
   *  over siblings during a drag shouldn't paint a hover rect on each). */
  clearLayerHover: () => void
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

  // Gesture phase book-keeping the controller owns (lifted out of `canvas.tsx`).
  // `activeGapHandle` and `hoveredReorderIframeLayerId` surface in the returned
  // state where the render tree needs them (the wrapper cursor, the reorder dot
  // highlight); `layerDraggingRef` gates the component's hover outline; the two
  // *Held / Active refs feed the window key listeners below.
  const [activeGapHandle, setActiveGapHandle] = useState<ActiveGapHandle | null>(
    null
  )
  const [hoveredReorderIframeLayerId, setHoveredReorderIframeLayerId] =
    useState<string | null>(null)
  /** True while any Layer (frame or group) is being drag-moved — used to
   *  suppress the hover outline so sweeping over siblings doesn't paint one. */
  const layerDraggingRef = useRef(false)
  /** True while a group-move gesture is in flight — gates the merge meta-key
   *  listener that flips the merge preview the instant cmd is pressed/released. */
  const [moveGestureActive, setMoveGestureActive] = useState(false)
  /** Live cmd/meta state during a device-resize — read when building each
   *  `resizeMove` event so the snap bypass stays accurate between pointer moves. */
  const resizeMetaHeldRef = useRef(false)

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

  // While a reorder is in flight, track meta-key changes even when the pointer
  // isn't moving so the pop-out preview flips the instant cmd is pressed or
  // released. The Preview's reorder slice tells us a reorder is active.
  const reorderActive = preview.reorder != null
  useEffect(() => {
    if (!reorderActive) return
    const onKey = (ev: KeyboardEvent) =>
      dispatch({ type: "metaChange", meta: ev.metaKey })
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [reorderActive, dispatch])

  // Flip the merge-snap preview the instant cmd/meta is pressed or released
  // between moves — meta held drops the group freely instead of merging. The
  // move gesture's FSM recomputes the merge preview from the `metaChange` event.
  useEffect(() => {
    if (!moveGestureActive) return
    const onKey = (ev: KeyboardEvent) =>
      dispatch({ type: "metaChange", meta: ev.metaKey })
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [moveGestureActive, dispatch])

  // Holding cmd/meta during a resize disables the device-size snap so the user
  // can fine-tune past a preset. Tracked via window listeners so it stays
  // accurate between pointer moves (e.g. cmd pressed while idle on a preset).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      resizeMetaHeldRef.current = ev.metaKey
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [])

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

      // Handle-hover tracking runs on every wrapper move (a move-drag captures on
      // the Layer, so the wrapper doesn't fire then — only reorder/gap drags,
      // which capture on the wrapper, reach here mid-gesture). Track which gap
      // handle and reorder dot the cursor is over so the wrapper shows the right
      // cursor and the dot fills in; while dragging, lock to the dragged handle
      // even if the cursor strays off it.
      const hoverCanvas = toCanvas(i, e)
      if (hoverCanvas) {
        const nextGap: ActiveGapHandle | null =
          state.kind === "gap"
            ? { groupId: state.ctx.groupId, gapIndex: state.ctx.gapIndex }
            : (() => {
                const hit = hitTestGapHandle(
                  i.gapHandles,
                  hoverCanvas.x,
                  hoverCanvas.y,
                  i.zoom
                )
                return hit
                  ? { groupId: hit.groupId, gapIndex: hit.gapIndex }
                  : null
              })()
        setActiveGapHandle((prev) => {
          if (
            prev === nextGap ||
            (prev &&
              nextGap &&
              prev.groupId === nextGap.groupId &&
              prev.gapIndex === nextGap.gapIndex)
          )
            return prev
          return nextGap
        })

        if (state.kind === "reorder") {
          const draggedId = state.ctx.memberId
          setHoveredReorderIframeLayerId((prev) =>
            prev === draggedId ? prev : draggedId
          )
        } else {
          const hit = hitTestReorderHandle(
            i.reorderHandles,
            hoverCanvas.x,
            hoverCanvas.y,
            i.zoom
          )
          const nextId = hit?.iframeLayerId ?? null
          setHoveredReorderIframeLayerId((prev) =>
            prev === nextId ? prev : nextId
          )
        }
      }

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
        setHoveredReorderIframeLayerId(hit?.iframeLayerId ?? null)
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

  // ── Layer-initiated gestures ──────────────────────────────────────────────
  // The drag/resize that begin *on a Layer* (group move with edge/merge snap,
  // in-flow reorder, device-resize) enter the same Canvas Gesture seam as the
  // pointer-root gestures above — the Layer's drag/resize hook calls these
  // controller handlers, which assemble the `start` context from plain snapshots
  // (the pure `assembleMoveStart` / `assembleReorderStart`) and dispatch.

  /**
   * Begin a group move. Reads the live selection + group/layout snapshots, lets
   * the pure {@link assembleMoveStart} decide which Groups translate and snapshot
   * the edge-snap union/candidates and merge candidates, marks the gesture
   * active, and dispatches the `move` start. The FSM then drives the live
   * `moveBy` and (on release) `mergeGroups` intents.
   */
  const onGroupDragStart = useCallback(
    (layerId: string) => {
      const i = inputsRef.current
      if (!i) return
      layerDraggingRef.current = true
      i.clearLayerHover()
      const { groups, layouts } = i.getMoveAssembly()
      const start = assembleMoveStart({
        layerId,
        selectedIframeLayerIds: i.baseIframeLayerIds,
        selectedDocumentLayerIds: i.baseDocumentLayerIds,
        selectedGroupIds: i.selectedGroupIds,
        groups,
        layouts,
        zoom: i.zoom,
      })
      setMoveGestureActive(true)
      dispatch({ type: "start", start })
    },
    [inputsRef, dispatch]
  )

  /**
   * Group drag end: release the move gesture. Any merge commit (and the
   * follow-on selection update) lands through the FSM's `mergeGroups` intent —
   * the live position was already committed by the per-move `moveBy` intents.
   */
  const onGroupDragEnd = useCallback(
    (metaKey: boolean) => {
      layerDraggingRef.current = false
      setMoveGestureActive(false)
      dispatch({ type: "release", meta: metaKey })
    },
    [dispatch]
  )

  /**
   * A group-move heartbeat from a Layer's drag hook. The dragged members, snap
   * union/candidates, and merge candidates were snapshotted at start, so the
   * move carries only the cumulative cursor delta and live meta state. The
   * selected-vs-single-layer routing the Layers do (`onMoveSelected` vs
   * `onMoveGroup`) collapses here — both feed the same gesture.
   */
  const onMove = useCallback(
    (totalDx: number, totalDy: number, metaKey: boolean) => {
      dispatch({ type: "move", cursor: { x: totalDx, y: totalDy }, meta: metaKey })
    },
    [dispatch]
  )

  /**
   * Begin an in-flow reorder from a Layer-owned affordance (a member's name
   * label). Mirrors the canvas reorder-dot path through the pure
   * {@link assembleReorderStart}, but with `selectOnNoMove` so a click that never
   * moves still selects the member. Returns `true` when the reorder took over the
   * pointer; `false` for single-member groups where reorder doesn't apply.
   */
  const onRequestReorderDrag = useCallback(
    (iframeLayerId: string, e: React.PointerEvent): boolean => {
      const i = inputsRef.current
      if (!i) return false
      const group = i.groups.find((g) =>
        g.members.some((m) => m.id === iframeLayerId)
      )
      if (!group || group.members.length < 2) return false
      const wrapper = i.getWrapper()
      const transform = i.getTransform()
      if (!wrapper || !transform) return false
      const rect = wrapper.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect, transform)
      const start = assembleReorderStart({
        iframeLayerId,
        canvas,
        groups: i.groups,
        memberLayouts: i.memberLayouts,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        selectOnNoMove: true,
      })
      if (!start) return false
      dispatch({ type: "start", start })
      wrapper.setPointerCapture(e.pointerId)
      e.stopPropagation()
      e.preventDefault()
      return true
    },
    [inputsRef, dispatch]
  )

  /**
   * Device-resize start: snapshot the frame's size + dragged edge and begin the
   * resize gesture. Each subsequent {@link onResize} feeds the raw delta through
   * the FSM (which orchestrates the device snap); the `resizeLayer` intent
   * commits the live resize.
   */
  const onResizeStart = useCallback(
    (id: string, edge: ResizeEdge) => {
      const i = inputsRef.current
      if (!i) return
      const size = i.getIframeLayerSize(id)
      if (!size) return
      dispatch({
        type: "start",
        start: {
          kind: "resize",
          ctx: {
            iframeLayerId: id,
            edge,
            initialWidth: size.width,
            initialHeight: size.height,
          },
        },
      })
    },
    [inputsRef, dispatch]
  )

  /**
   * A resize heartbeat from a single frame's edge. The hook emits raw
   * screen-derived size deltas (`dw`, `dh`); forward them (with the live
   * meta-snap-bypass flag and zoom) to the FSM, which accumulates them, runs the
   * device snap, and emits the `resizeLayer` intent. The `id`/`edge`/`dx`/`dy`
   * the hook also sends are redundant — the FSM holds the edge and derives the
   * group-anchor shift — so they're ignored here.
   */
  const onResize = useCallback(
    (
      _id: string,
      _edge: ResizeEdge,
      _dx: number,
      _dy: number,
      dw: number,
      dh: number
    ) => {
      const i = inputsRef.current
      if (!i) return
      dispatch({
        type: "resizeMove",
        dw,
        dh,
        metaHeld: resizeMetaHeldRef.current,
        zoom: i.zoom,
      })
    },
    [inputsRef, dispatch]
  )

  /**
   * Resize end: a resize changes the frame's rect, so its retained thumbnail no
   * longer matches — mark it dirty so the heartbeat recaptures it, but only when
   * the size actually changed (grabbing and releasing a handle without dragging
   * shouldn't trigger a recapture). The FSM holds the start and current size.
   */
  const onResizeEnd = useCallback(() => {
    const i = inputsRef.current
    const st = stateRef.current
    if (
      i &&
      st.kind === "resize" &&
      (st.device.width !== st.ctx.initialWidth ||
        st.device.height !== st.ctx.initialHeight)
    ) {
      i.markFrameDirty(st.ctx.iframeLayerId)
    }
    dispatch({ type: "release" })
  }, [inputsRef, dispatch])

  /** Clear the handle-hover state (the wrapper's pointer-leave). */
  const resetHandleHover = useCallback(() => {
    setActiveGapHandle(null)
    setHoveredReorderIframeLayerId(null)
  }, [])

  /** True while a Layer drag-move is in flight — the component reads this to
   *  suppress the hover outline. */
  const isLayerDragging = useCallback(() => layerDraggingRef.current, [])

  // Stable reference for the Layer drag/resize callbacks: these handlers are
  // passed whole to the (memoized) flat member layer, so a fresh object each
  // render would re-render every Layer on every canvas state change (e.g. a
  // pan). The callbacks themselves are already `useCallback`-stable.
  const layerHandlers = useMemo(
    () => ({
      onGroupDragStart,
      onGroupDragEnd,
      onMove,
      onRequestReorderDrag,
      onResizeStart,
      onResize,
      onResizeEnd,
    }),
    [
      onGroupDragStart,
      onGroupDragEnd,
      onMove,
      onRequestReorderDrag,
      onResizeStart,
      onResize,
      onResizeEnd,
    ]
  )

  return {
    preview,
    dispatch,
    getState,
    /** Gesture phase state surfaced for the render tree (cursor + dot highlight). */
    activeGapHandle,
    hoveredReorderIframeLayerId,
    isLayerDragging,
    resetHandleHover,
    handlers: {
      onPointerDownCapture,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
    /** Callbacks the Layer components dispatch their drag/resize through. */
    layerHandlers,
  }
}
