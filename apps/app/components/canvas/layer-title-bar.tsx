"use client"

import { useMemo } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { EditableText } from "@workspace/ui/components/editable-text"
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
  /** Color for the group label when it's selected by a *remote* user. When
   *  set (and not locally `groupSelected`), the label is tinted to this
   *  color to match that user's selection rect. */
  groupSelectedColor?: string
  onSelectGroup?: (shiftKey: boolean) => void
  /** Optional inline rename for the group label. */
  onRenameGroup?: (next: string) => void
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
  groupSelectedColor,
  onSelectGroup,
  onRenameGroup,
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
            color={groupSelectedColor}
            onSelectGroup={onSelectGroup}
            onRename={onRenameGroup}
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
  /** Color of a *remote* user's selection. When set (and not locally
   *  `selected`), the title is tinted to this color to match that user's
   *  selection rect. Local selection (fuchsia) takes precedence. */
  color?: string
  /** Pointer-down handler — selects the layer on press. Mirrors the layer
   *  body's instant-select so the title click feels identical to clicking
   *  the layer itself. */
  onSelectLayer: (shiftKey: boolean) => void
  /** Optional rename. When provided, double-click swaps the label into an
   *  inline contenteditable. */
  onRename?: (next: string) => void
  /** Placeholder shown when the title is empty. */
  placeholder?: string
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
export function LayerTitleText({
  title,
  selected,
  color,
  onSelectLayer,
  onRename,
  placeholder,
}: LayerTitleTextProps) {
  // Local selection (fuchsia) wins; a remote selector's color applies only
  // when we haven't selected the layer ourselves.
  const remoteColor = !selected && color ? color : undefined
  const colorClass = selected
    ? "text-fuchsia-500"
    : remoteColor
      ? undefined
      : "text-foreground/70"
  const colorStyle = remoteColor ? { color: remoteColor } : undefined
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    onSelectLayer(e.shiftKey)
  }

  if (onRename) {
    return (
      <EditableText
        as="span"
        value={title}
        placeholder={placeholder}
        onCommit={onRename}
        onPointerDown={handlePointerDown}
        style={colorStyle}
        className={cn("min-w-0 text-xs font-medium", colorClass)}
        // Clip the read-only label inside the row's max-width; during edit
        // let the caret/text grow naturally so the user can see what they're
        // typing past the truncate boundary.
        viewClassName="truncate cursor-grab active:cursor-grabbing"
        editClassName="relative z-10 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
      />
    )
  }

  return (
    <span
      className={cn(
        "min-w-0 cursor-grab truncate text-xs font-medium active:cursor-grabbing",
        colorClass
      )}
      style={colorStyle}
      onPointerDown={handlePointerDown}
    >
      {title}
    </span>
  )
}
