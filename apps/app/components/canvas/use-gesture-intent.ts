"use client"

import { useCallback } from "react"

import { getGroupMembers } from "@/lib/canvas/layout"
import type { GestureIntent } from "@/lib/canvas/gesture"
import type { CanvasOps } from "@/lib/canvas/ops"
import type { RoomCollections } from "@/lib/yjs/schema"
import type { CanvasSelection } from "./use-canvas-selection"

/**
 * The apply-side of the Canvas Gesture seam: turns an emitted {@link GestureIntent}
 * into committed canvas state. The gesture FSM (`useCanvasGesture`) decides and
 * emits; this hook applies — canvas-mutating intents through Canvas Operations
 * (ADR 0001), selection-only ones (`marqueeSelect` / `selectMember`) through the
 * Canvas Selection controller. The gesture itself never touches the Y.Doc.
 *
 * Lives next to `use-canvas-gesture` because it is "what a finished gesture
 * commits" — the three live-commit Canvas Operations the gesture intents map to
 * (gap-resize, group move, device-resize) plus the intent dispatch that routes
 * each intent to its operation or selection write.
 */
export function useGestureIntent({
  collections,
  ops,
  selection,
}: {
  collections: RoomCollections
  ops: CanvasOps
  selection: CanvasSelection
}): (intent: GestureIntent) => void {
  // Canvas Operation: set a group's inter-member gap. Applied by the Canvas
  // Gesture's `setGroupGap` intent on gap-resize release.
  const setGroupGap = useCallback(
    (groupId: string, gap: number) => {
      ops.patch("iframeLayerGroups", groupId, { gap: Math.max(0, gap) })
    },
    [ops]
  )

  // Canvas Operation: translate every group referenced by `ids` by (dx, dy).
  // Applied by the Canvas Gesture's `moveBy` intent on each move.
  const moveIframeLayersByDelta = useCallback(
    (ids: readonly string[], dx: number, dy: number) => {
      const idSet = new Set(ids)
      ops.batch(() => {
        for (const g of collections.iframeLayerGroups.toArray()) {
          if (getGroupMembers(g).some((m) => idSet.has(m.id))) {
            ops.patch("iframeLayerGroups", g.id, { x: g.x + dx, y: g.y + dy })
          }
        }
      })
    },
    [collections, ops]
  )

  // Canvas Operation: apply one device-resize step. Resizes the layer to the
  // gesture's snapped size and shifts the parent group so the un-dragged edge
  // stays pinned (the shift is non-zero only for left/top edge drags). Applied
  // from the Canvas Gesture's `resizeLayer` intent on every resize move — the
  // frame resizes live, as it did before the FSM port.
  const resizeLayer = useCallback(
    (
      iframeLayerId: string,
      width: number,
      height: number,
      shiftX: number,
      shiftY: number
    ) => {
      ops.batch(() => {
        if (shiftX !== 0 || shiftY !== 0) {
          for (const g of collections.iframeLayerGroups.toArray()) {
            if (getGroupMembers(g).some((m) => m.id === iframeLayerId)) {
              ops.patch("iframeLayerGroups", g.id, {
                x: g.x + shiftX,
                y: g.y + shiftY,
              })
              break
            }
          }
        }
        ops.patch("iframeLayers", iframeLayerId, { width, height })
      })
    },
    [collections, ops]
  )

  return useCallback(
    (intent: GestureIntent) => {
      switch (intent.type) {
        case "setGroupGap":
          setGroupGap(intent.groupId, intent.gap)
          break
        case "moveBy":
          moveIframeLayersByDelta(intent.memberIds, intent.dx, intent.dy)
          break
        case "mergeGroups": {
          // The target absorbs the source — its world (x, y) stays put, so the
          // merged row stays where the user dropped onto. Read the source's
          // members before the merge so selection can follow the dragged layers.
          const source = collections.iframeLayerGroups.get(intent.sourceId)
          const target = collections.iframeLayerGroups.get(intent.targetId)
          if (!source || !target || source.id === target.id) break
          const sourceMembers = getGroupMembers(source)
          if (sourceMembers.length === 0) break
          ops.mergeGroups(source.id, target.id)
          // Keep the dragged layers selected rather than the merged target group.
          // The source group is gone, so map its former members to individual
          // iframe/document selections.
          const draggedIframeIds = new Set<string>()
          const draggedDocumentIds = new Set<string>()
          for (const m of sourceMembers) {
            if (m.kind === "iframe-layer") draggedIframeIds.add(m.id)
            else if (m.kind === "markdown-layer") draggedDocumentIds.add(m.id)
          }
          selection.setGroupIds(new Set())
          selection.setIframeLayerIds(draggedIframeIds)
          selection.setDocumentLayerIds(draggedDocumentIds)
          break
        }
        case "reorderMember":
          // In-flow reorder commits live: each tick the cursor crosses a sibling
          // center, the gesture emits the new ordering and we write it.
          ops.patch("iframeLayerGroups", intent.groupId, {
            members: intent.members,
          })
          break
        case "popOutToNewGroup": {
          // Meta held at release → split the popped Member into a fresh Group
          // anchored where it was floating; select it like the old inline path.
          // Skip if the underlying layer vanished mid-drag so we never select a
          // group that `splitToNewGroup` declined to create.
          const exists =
            collections.iframeLayers.get(intent.memberId) != null ||
            collections.markdownLayers.get(intent.memberId) != null
          if (!exists) break
          const newGroupId = ops.splitToNewGroup([intent.memberId], {
            x: intent.x,
            y: intent.y,
          })
          selection.setGroupIds(new Set([newGroupId]))
          break
        }
        case "selectMember":
          // Click-no-move from a Member's label falls through to plain
          // selection — the same selection interface the click path uses.
          selection.selectMember(intent.memberId, intent.kind, intent.additive)
          break
        // Selection-only intent: applied to local selection state, never the
        // Y.Doc. A marquee never selects groups, so the interface clears them.
        case "marqueeSelect":
          selection.applyMarquee(intent.iframeLayerIds, intent.documentLayerIds)
          break
        case "resizeLayer":
          resizeLayer(
            intent.iframeLayerId,
            intent.width,
            intent.height,
            intent.shiftX,
            intent.shiftY
          )
          break
      }
    },
    [collections, ops, selection, setGroupGap, moveIframeLayersByDelta, resizeLayer]
  )
}
