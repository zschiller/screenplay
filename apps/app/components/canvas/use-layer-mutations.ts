import { type RefObject, useCallback, useMemo } from "react"
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch"

import type { CanvasOps } from "@/lib/canvas/ops"
import type { RoomCollections } from "@/lib/yjs/schema"
import type { MockupStatus } from "@/lib/types"
import type { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"
import { getGroupMembers } from "@/lib/canvas/layout"
import { MOCKUP_MIN_HEIGHT, MOCKUP_MIN_WIDTH } from "@/lib/constants"
import {
  MIN_IFRAME_LAYER_HEIGHT,
  MIN_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"

/**
 * Layer Mutation controller (PRD #579, cut 1/4) — the single home for the thin
 * per-Layer Canvas Operation wrappers that used to be ~one-line `useCallback`s
 * inlined in `components/canvas/canvas.tsx` and drilled into
 * `CanvasMemberLayer` as ~13 separate props. Bundled here behind one
 * `LayerMutations` object passed down as a single prop, exactly the way
 * `selection`, `camera`, and `reference` are already passed as whole
 * controllers.
 *
 * This is the React binding, not a new write path: every Layer-record write
 * still routes through the Canvas Operations seam (`ops`, ADR 0001) and never
 * touches the Y.Doc directly. The mutators that carry real composition or
 * React/viewport side effects keep their bodies intact rather than collapsing
 * to a bare `patch`:
 *  - `updateRoute` reports the Create-Flow trail pan and applies it to the
 *    zoom/pan transform so the navigated frame stays visually anchored.
 *  - `fitToContent` marks the frame's thumbnail dirty when its size actually
 *    changes, so a recapture fires at the new size.
 *
 * Constructed from `ops`, `collections`, and the dirty-frame `captureTracker`,
 * plus the two refs `updateRoute` reads — the zoom/pan transform handle and the
 * live Create-Flow selection. Those arrive as refs (the established mirror
 * pattern) because they're owned by state defined later in the component, and
 * reading them through refs keeps every verb `useCallback`-stable.
 */
export interface LayerMutationInputs {
  ops: CanvasOps
  collections: RoomCollections
  captureTracker: DirtyFrameTracker
  /** Zoom/pan handle — `updateRoute` applies the Create-Flow trail pan to it. */
  transformRef: RefObject<ReactZoomPanPinchContentRef | null>
  /** Live Create-Flow frame selection — `updateRoute` clones the trail only
   *  when navigating the frame the user is building a trail from. */
  createFlowIframeLayerIdRef: RefObject<string | null>
}

export interface LayerMutations {
  // --- Iframe Layer field writers ---
  /** Rename a frame's label. */
  rename: (id: string, label: string) => void
  /** Assign (or reassign) the frame's branch. */
  assignAgent: (iframeLayerId: string, agentId: string) => void
  /** Show a whole Group from another branch: every frame that follows it
   *  moves, exceptions stay (#869). */
  assignGroupAgent: (groupId: string, agentId: string) => void
  /** Persist the frame's serialized iframe state. */
  updateState: (id: string, state: JsonObject) => void
  /** Persist the frame's scroll position. */
  updateScroll: (id: string, scrollX: number, scrollY: number) => void
  /** Persist the knob declarations the frame's page exposed. */
  updateKnobs: (id: string, knobs: JsonValue[]) => void
  /** Persist the current knob values. */
  updateKnobValues: (id: string, knobValues: JsonObject) => void
  /** Persist the frame's shared state. */
  updateSharedState: (id: string, sharedState: JsonObject) => void
  /**
   * Navigate (or replace) the frame's route. In Create Flow this leaves a
   * trail clone and pans the viewport so the navigated frame stays anchored;
   * a `replace` change edits the URL in place and never leaves a trail.
   */
  updateRoute: (id: string, route: string, replace?: boolean) => void
  /**
   * Resize the frame to fit its content (or a device preset). Marks the
   * thumbnail dirty only when the size actually changes.
   */
  fitToContent: (id: string, width: number, height: number) => void

  // --- Markdown Layer writers ---
  /** Resize a document by edge deltas, shifting its group anchor as needed. */
  resizeDocument: (
    id: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => void
  /** Rename a document from outside the editor (writes the first heading). */
  setTitle: (id: string, title: string) => void
  /** Mirror the editor's first-heading text onto the cached title (cache-only). */
  setTitleCache: (id: string, title: string) => void

  // --- Mockup Layer writers ---
  /** Resize a mockup by edge deltas, shifting its group anchor as needed. */
  resizeMockup: (
    id: string,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => void
  /** Rename a mockup (its title lives on the record alone). */
  renameMockup: (id: string, title: string) => void
  setMockupStatus: (id: string, status: MockupStatus) => void
  /** Persist the knob declarations a mockup's page exposed. */
  updateMockupKnobs: (id: string, knobs: JsonValue[]) => void
  /** Persist a mockup's current knob values. */
  updateMockupKnobValues: (id: string, knobValues: JsonObject) => void
  /** Persist the state a mockup's page shares. */
  updateMockupSharedState: (id: string, sharedState: JsonObject) => void
}

export function useLayerMutations({
  ops,
  collections,
  captureTracker,
  transformRef,
  createFlowIframeLayerIdRef,
}: LayerMutationInputs): LayerMutations {
  const rename = useCallback(
    (id: string, label: string) => {
      ops.patch("iframeLayers", id, { label })
    },
    [ops]
  )

  const assignAgent = useCallback(
    (iframeLayerId: string, agentId: string) => {
      ops.assignBranch(iframeLayerId, agentId)
    },
    [ops]
  )

  const assignGroupAgent = useCallback(
    (groupId: string, agentId: string) => {
      ops.assignGroupBranch(groupId, agentId)
    },
    [ops]
  )

  const updateState = useCallback(
    (id: string, state: JsonObject) => {
      ops.patch("iframeLayers", id, { iframeState: state })
    },
    [ops]
  )

  const updateScroll = useCallback(
    (id: string, scrollX: number, scrollY: number) => {
      ops.patch("iframeLayers", id, { scrollX, scrollY })
    },
    [ops]
  )

  const updateKnobs = useCallback(
    (id: string, knobs: JsonValue[]) => {
      ops.patch("iframeLayers", id, { knobs })
    },
    [ops]
  )

  const updateKnobValues = useCallback(
    (id: string, knobValues: JsonObject) => {
      ops.patch("iframeLayers", id, { knobValues })
    },
    [ops]
  )

  const updateSharedState = useCallback(
    (id: string, sharedState: JsonObject) => {
      ops.patch("iframeLayers", id, { sharedState })
    },
    [ops]
  )

  const updateRoute = useCallback(
    (id: string, route: string, replace = false) => {
      // In Create Flow mode the verb leaves a clone of the previous route in
      // the group (immediately left of the navigated frame) and reports how far
      // to pan so the navigated frame stays visually anchored as the trail
      // grows leftward. The pan is the only part that touches React/viewport
      // state, so it stays here; every Y.Doc write lives behind the verb.
      //
      // A `replace` change (replaceState / initial-load report) edits the
      // current URL in place rather than navigating, so it never leaves a
      // trail clone — otherwise a framework's post-navigation replaceState
      // (path normalization, query/scroll sync) would double every step.
      const cloneTrail = !replace && createFlowIframeLayerIdRef.current === id
      const { viewportShift } = ops.navigateRoute(id, route, { cloneTrail })

      if (viewportShift > 0) {
        const ref = transformRef.current
        if (ref) {
          const { positionX, positionY, scale } = ref.state
          ref.setTransform(
            positionX - viewportShift * scale,
            positionY,
            scale,
            0
          )
        }
      }
    },
    [ops, transformRef, createFlowIframeLayerIdRef]
  )

  const fitToContent = useCallback(
    (id: string, width: number, height: number) => {
      // Ceil rather than round so sub-pixel content extents never shrink the
      // iframeLayer below the actual content (which would creep smaller on each
      // repeated Fit click).
      const newWidth = Math.max(MIN_IFRAME_LAYER_WIDTH, Math.ceil(width))
      const newHeight = Math.max(MIN_IFRAME_LAYER_HEIGHT, Math.ceil(height))
      const prev = collections.iframeLayers.get(id)
      ops.patch("iframeLayers", id, { width: newWidth, height: newHeight })
      // Fit-to-content and device-size presets resize the frame too, so the
      // manifest discards its now-mismatched capture — mark it dirty to
      // recapture at the new size when the size actually changed.
      if (prev && (prev.width !== newWidth || prev.height !== newHeight)) {
        captureTracker.markDirty(id)
      }
    },
    [ops, collections, captureTracker]
  )

  // Resize a box Layer (a Document or a Mockup) by edge deltas, clamped to its
  // kind's floor; a left/top edge shifts the Group anchor so the far edge
  // stays put.
  const resizeBoxLayer = useCallback(
    (
      key: "markdownLayers" | "mockupLayers",
      min: { width: number; height: number },
      id: string,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ) => {
      ops.batch(() => {
        const d = collections[key].get(id)
        if (!d) return
        const newWidth = Math.max(min.width, d.width + dw)
        const newHeight = Math.max(min.height, d.height + dh)
        const actualDw = newWidth - d.width
        const actualDh = newHeight - d.height
        const shiftX = dx === 0 ? 0 : -actualDw
        const shiftY = dy === 0 ? 0 : -actualDh
        if (shiftX !== 0 || shiftY !== 0) {
          for (const g of collections.iframeLayerGroups.toArray()) {
            if (getGroupMembers(g).some((m) => m.id === id)) {
              ops.patch("iframeLayerGroups", g.id, {
                x: g.x + shiftX,
                y: g.y + shiftY,
              })
              break
            }
          }
        }
        if (actualDw !== 0 || actualDh !== 0) {
          ops.patch(key, id, {
            width: newWidth,
            height: newHeight,
          })
        }
      })
    },
    [collections, ops]
  )

  const resizeDocument = useCallback(
    (id: string, dx: number, dy: number, dw: number, dh: number) =>
      resizeBoxLayer(
        "markdownLayers",
        { width: 200, height: 120 },
        id,
        dx,
        dy,
        dw,
        dh
      ),
    [resizeBoxLayer]
  )

  const resizeMockup = useCallback(
    (id: string, dx: number, dy: number, dw: number, dh: number) =>
      resizeBoxLayer(
        "mockupLayers",
        { width: MOCKUP_MIN_WIDTH, height: MOCKUP_MIN_HEIGHT },
        id,
        dx,
        dy,
        dw,
        dh
      ),
    [resizeBoxLayer]
  )

  const renameMockup = useCallback(
    (id: string, title: string) => {
      ops.patch("mockupLayers", id, { title })
    },
    [ops]
  )

  const setMockupStatus = useCallback(
    (id: string, status: MockupStatus) => {
      ops.patch("mockupLayers", id, { status })
    },
    [ops]
  )

  // Every viewer's copy of a page posts its declarations as it loads, so
  // write only a real change.
  const updateMockupKnobs = useCallback(
    (id: string, knobs: JsonValue[]) => {
      const current = collections.mockupLayers.get(id)
      if (!current) return
      if (JSON.stringify(current.knobs ?? []) === JSON.stringify(knobs)) return
      ops.patch("mockupLayers", id, { knobs })
    },
    [ops, collections]
  )

  const updateMockupKnobValues = useCallback(
    (id: string, knobValues: JsonObject) => {
      ops.patch("mockupLayers", id, { knobValues })
    },
    [ops]
  )

  const updateMockupSharedState = useCallback(
    (id: string, sharedState: JsonObject) => {
      ops.patch("mockupLayers", id, { sharedState })
    },
    [ops]
  )

  const setTitle = useCallback(
    (id: string, title: string) => {
      ops.renameDocument(id, title)
    },
    [ops]
  )

  const setTitleCache = useCallback(
    (id: string, title: string) => {
      ops.patch("markdownLayers", id, { title })
    },
    [ops]
  )

  // Memoized so the controller object stays stable across renders (every verb
  // is `useCallback`-stable over its stable inputs); consumers list
  // `layerMutations` whole in dep arrays — matching the other canvas
  // controllers — without re-binding long-lived handlers each render.
  return useMemo(
    () => ({
      rename,
      assignAgent,
      assignGroupAgent,
      updateState,
      updateScroll,
      updateKnobs,
      updateKnobValues,
      updateSharedState,
      updateRoute,
      fitToContent,
      resizeDocument,
      setTitle,
      setTitleCache,
      resizeMockup,
      renameMockup,
      setMockupStatus,
      updateMockupKnobs,
      updateMockupKnobValues,
      updateMockupSharedState,
    }),
    [
      rename,
      assignAgent,
      assignGroupAgent,
      updateState,
      updateScroll,
      updateKnobs,
      updateKnobValues,
      updateSharedState,
      updateRoute,
      fitToContent,
      resizeDocument,
      setTitle,
      setTitleCache,
      resizeMockup,
      renameMockup,
      setMockupStatus,
      updateMockupKnobs,
      updateMockupKnobValues,
      updateMockupSharedState,
    ]
  )
}
