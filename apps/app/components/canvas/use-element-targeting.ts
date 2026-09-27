import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch"

import {
  ElementTargeting,
  type GetTargetingFrameDom,
  partitionTargetFrames,
  projectHighlight,
  targetableBranchIds,
} from "@/lib/canvas/element-targeting"
import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import { screenToCanvas } from "@/lib/canvas/route"
import type { DomRect } from "@/lib/postmessage-protocol"
import { targetingStore } from "@/lib/targeting-store"
import type { IframeLayerData } from "@/lib/types"

/**
 * Element Targeting controller (PRD #616, #705) — the React binding for a
 * Composer's one-shot crosshair pick of an element on the canvas. The Canvas is
 * the sole fulfiller of `targetingStore` pick requests and the sole highlighter
 * of hovered element tokens; this controller registers both, feeds the
 * React-free `ElementTargeting` core (`lib/canvas/element-targeting`, which owns
 * the pick state machine, the eligibility rule, the hit-test and the highlight
 * sequencing), and publishes which Branches have a targetable frame.
 *
 * Escape is not handled here: an armed pick is the top step of the shared
 * Escape precedence (`resolveEscapeAction`), which the Canvas Keyboard applies
 * by calling `cancel`.
 */
export interface ElementTargetingDeps {
  /** Live, synced Iframe Layers — the eligibility rule runs over these. */
  iframeLayers: IframeLayerData[]
  /** World-space frame layouts — the hit-test and highlight projection. */
  iframeLayerLayouts: IframeLayerLayoutMap
  /** Per-frame DOM bridge; absent for a closed frame. */
  getIframeLayerDom: GetTargetingFrameDom
  /** Pan/zoom controller — converts a click to world space. */
  transformRef: RefObject<ReactZoomPanPinchContentRef | null>
}

export interface ElementTargetingController {
  /** A pick is armed: crosshair cursor, dimming, clicks route to `handleClick`. */
  pickActive: boolean
  /** Live read of `pickActive` for long-lived handlers (the Escape dispatch). */
  isPickActive(): boolean
  /** Frames drawn dimmed during a pick (every non-eligible frame). */
  dimmedIds: ReadonlySet<string>
  /** Hovered-token outline in world space, or null. */
  highlightRect: DomRect | null
  /** Canvas click while a pick is armed: hit-test and resolve. */
  handleClick(e: React.MouseEvent): void
  /** Cancel the pending pick (resolves `null`). */
  cancel(): void
}

export function useElementTargeting(
  deps: ElementTargetingDeps
): ElementTargetingController {
  const { iframeLayers, iframeLayerLayouts, getIframeLayerDom, transformRef } =
    deps
  const [core] = useState(() => new ElementTargeting())
  const snapshot = useSyncExternalStore(
    core.subscribe,
    core.getSnapshot,
    core.getSnapshot
  )

  // The highlight handler outlives renders; read the live DOM accessor.
  const getDomRef = useRef(getIframeLayerDom)
  useEffect(() => {
    getDomRef.current = getIframeLayerDom
  })

  useEffect(() => {
    const unregisterPick = targetingStore.register((request) =>
      core.request(request)
    )
    const unregisterHighlight = targetingStore.registerHighlight((target) =>
      core.highlight(target, (id) => getDomRef.current(id))
    )
    return () => {
      unregisterPick()
      unregisterHighlight()
      core.reset()
    }
  }, [core])

  // Publish which Branches have a targetable frame so each Composer can disable
  // its target affordance when picking would have nothing to hit (#619). Cleared
  // on unmount so a stale set doesn't outlive the Room.
  const branchIds = useMemo(
    () => targetableBranchIds(iframeLayers),
    [iframeLayers]
  )
  useEffect(() => {
    targetingStore.publishEligibleBranches(branchIds)
  }, [branchIds])
  useEffect(() => {
    return () => targetingStore.publishEligibleBranches(new Set())
  }, [])

  const { dimmedIds } = useMemo(
    () => partitionTargetFrames(snapshot.armedBranchId, iframeLayers),
    [snapshot.armedBranchId, iframeLayers]
  )

  const highlightRect = useMemo(
    () => projectHighlight(snapshot.highlight, iframeLayerLayouts),
    [snapshot.highlight, iframeLayerLayouts]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!core.isArmed()) return
      const transform = transformRef.current
      if (!transform) {
        core.cancel()
        return
      }
      core.click({
        point: screenToCanvas(
          e.clientX,
          e.clientY,
          e.currentTarget.getBoundingClientRect(),
          transform.state
        ),
        iframeLayers,
        layouts: iframeLayerLayouts,
        getDom: getIframeLayerDom,
      })
    },
    [core, transformRef, iframeLayers, iframeLayerLayouts, getIframeLayerDom]
  )

  const isPickActive = useCallback(() => core.isArmed(), [core])
  const cancel = useCallback(() => core.cancel(), [core])

  return {
    pickActive: snapshot.phase === "armed",
    isPickActive,
    dimmedIds,
    highlightRect,
    handleClick,
    cancel,
  }
}
