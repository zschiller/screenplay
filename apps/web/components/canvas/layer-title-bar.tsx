"use client"

import { useMemo } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { GroupLabel } from "./group-label"

interface LayerTitleBarProps {
  /** Identifies which layer to lift when the user starts a reorder gesture
   *  from this bar. */
  layerId: string
  /** Underlying tile width in canvas units — clamps the bar so it can't
   *  extend past the tile's footprint. */
  layerWidth: number
  zoom: number
  /** Base move-drag handlers (translate the parent group). Pass `undefined`
   *  to detach all gesture handling (e.g. while a frame is in interactive
   *  mode or the user holds space to pan). */
  dragHandlers?: {
    onPointerDown: (e: React.PointerEvent) => void
    [key: string]: unknown
  }
  /** Ask the canvas to start a reorder drag from this bar. Returns `true`
   *  for multi-member groups (canvas owns the gesture); single-member groups
   *  return `false` and fall through to the base move drag. */
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  /** Group display name — only set on the leftmost member of a multi-member
   *  group (rendered above the layer-specific row). */
  groupLabel?: string
  groupSelected?: boolean
  onSelectGroup?: (shiftKey: boolean) => void
  /** Drag handlers for the GroupLabel button — translate the whole group
   *  rather than reordering a single member. */
  groupLabelDragHandlers?: Record<string, unknown>
  /** World-space translation applied to the parent layer container during a
   *  reorder drag. Passed here so the group label can apply the inverse and
   *  stay visually anchored to the source group's origin while the rest of
   *  the layer tracks the cursor. */
  reorderDragTranslateX?: number
  reorderDragTranslateY?: number
  /** True during cmd-pop preview — hides the group label so the
   *  about-to-be-new-group doesn't pretend it's still in the source. */
  reorderDragPopped?: boolean
  /** Layer-specific content rendered below the GroupLabel slot. Typically a
   *  title row plus accessories (HMR dot, route picker, branch picker, …). */
  children?: React.ReactNode
}

/**
 * Shared title-bar wrapper rendered above a canvas layer (frame or doc).
 *
 * Owns the cross-cutting behavior:
 *  - The absolute-positioned, `scale(1/zoom)` wrapper that keeps the bar at a
 *    constant screen size regardless of canvas zoom.
 *  - Composing the caller's base drag handlers with `onRequestReorderDrag` so
 *    pointerdown from the bar enters a reorder drag for multi-member groups
 *    and falls back to a group-move drag for single-member groups.
 *  - Rendering the optional `GroupLabel` (with inverse-translate during a
 *    reorder drag and full hide during a cmd-pop preview) above the
 *    layer-specific content.
 *
 * Layer-specific content (title text, HMR dot, route picker, branch picker,
 * hidden measurement copy, …) is provided as children so each layer kind
 * can compose its own row without re-implementing the wrapper or drag-handle
 * routing.
 */
export function LayerTitleBar({
  layerId,
  layerWidth,
  zoom,
  dragHandlers,
  onRequestReorderDrag,
  groupLabel,
  groupSelected,
  onSelectGroup,
  groupLabelDragHandlers,
  reorderDragTranslateX,
  reorderDragTranslateY,
  reorderDragPopped,
  children,
}: LayerTitleBarProps) {
  // Compose the caller's base move-drag handlers with the reorder-request
  // hook. Pointerdown first asks the canvas to lift this layer into a
  // reorder drag (multi-member groups capture the gesture); for single-
  // member groups we drop through to the base move drag.
  const labelDragHandlers = useMemo(() => {
    if (!dragHandlers) return undefined
    return {
      ...dragHandlers,
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return
        if (onRequestReorderDrag?.(layerId, e)) return
        dragHandlers.onPointerDown(e)
      },
    }
  }, [dragHandlers, onRequestReorderDrag, layerId])

  return (
    <div
      className="absolute bottom-full left-0 flex flex-col items-start whitespace-nowrap"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: "bottom left",
        maxWidth: layerWidth * zoom,
        marginBottom: 4 / zoom,
      }}
      {...labelDragHandlers}
    >
      {groupLabel && !reorderDragPopped && (
        <div
          style={
            reorderDragTranslateX != null || reorderDragTranslateY != null
              ? {
                  // The outer layer container is `translate(dx, dy)` in world
                  // units; this label sits inside a `scale(1/zoom)` wrapper,
                  // so its own local px need to be multiplied by `zoom` to
                  // produce the same world-space distance.
                  transform: `translate(${-(reorderDragTranslateX ?? 0) * zoom}px, ${-(reorderDragTranslateY ?? 0) * zoom}px)`,
                }
              : undefined
          }
        >
          <GroupLabel
            label={groupLabel}
            groupSelected={groupSelected}
            onSelectGroup={onSelectGroup}
            dragHandlers={groupLabelDragHandlers}
          />
        </div>
      )}
      {children}
    </div>
  )
}

interface LayerTitleTextProps {
  title: string
  /** True when the layer is selected (directly or via its group). Drives the
   *  fuchsia coloring that mirrors the canvas selection highlight. */
  selected?: boolean
  /** Pointer-down handler — selects the layer on press. Mirrors the layer
   *  body's instant-select so the title click feels identical to clicking
   *  the layer itself. */
  onSelectLayer: (shiftKey: boolean) => void
}

/**
 * The layer's display name, rendered as a selectable text span. Shared by
 * frames and docs so both kinds of title bar present the name with the same
 * affordance.
 *
 * Sizing is left to the parent row — the span truncates inside whatever
 * `max-width` its container imposes (frames clamp to leave room for action
 * buttons; docs let the bar's outer max-width do the clipping).
 */
export function LayerTitleText({ title, selected, onSelectLayer }: LayerTitleTextProps) {
  return (
    <span
      className={cn(
        "text-xs font-medium truncate min-w-[0.75em]",
        selected ? "text-fuchsia-500" : "text-foreground/70",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        onSelectLayer(e.shiftKey)
      }}
    >
      {title}
    </span>
  )
}
