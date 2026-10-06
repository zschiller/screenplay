"use client"

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type Ref,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@workspace/ui/lib/utils"
import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import type { LayerDragHandlers } from "@/hooks/use-layer-drag"
import { showsLayerDetail } from "@/lib/canvas/camera"
import { showsLayerLabel } from "@/lib/canvas/layer-labels"
import { GroupLabel, type GroupLabelValue } from "./group-label"
import { LabelFitContext, useLabelChatHidden } from "./label-chat"
import {
  LAYER_LABEL_ATTRIBUTE,
  LabelLayerContext,
  snapToDevicePixel,
} from "./label-layer"

/** Screen px between a label's bottom and its Layer's top edge. */
const LABEL_GAP = 4

interface LayerTitleBarProps {
  /** Identifies which layer to lift when the user starts a reorder gesture
   *  from this bar. */
  layerId: string
  /** Underlying tile width in canvas units — clamps the bar so it can't
   *  extend past the tile's footprint. */
  layerWidth: number
  /** The Layer's top-left in world units, where the label sits on screen. */
  worldX: number
  worldY: number
  /** Paint order among labels, the Layer's own. */
  zIndex?: number
  zoom: number
  /** Base move-drag handlers (translate the parent group). Pass `undefined`
   *  to detach all gesture handling (e.g. while a frame is in interactive
   *  mode or the user holds space to pan). */
  dragHandlers?: LayerDragHandlers
  /** Ask the canvas to start a reorder drag from this bar. Returns `true`
   *  for multi-member groups (canvas owns the gesture); single-member groups
   *  return `false` and fall through to the base move drag. */
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  /** The Group's label — only set on the leftmost member of a multi-member
   *  group (rendered above the layer-specific row). */
  groupLabel?: GroupLabelValue
  groupSelected?: boolean
  /** Drag handlers for the GroupLabel button — translate the whole group
   *  rather than reordering a single member. */
  groupLabelDragHandlers?: LayerDragHandlers
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
  /** Right-aligned to the layer on the title row, e.g. "Agent has control"
   *  (#1387). The title row truncates before it does. */
  tag?: React.ReactNode
}

/**
 * Shared title-bar wrapper rendered above a canvas layer (frame or doc).
 *
 * Owns the cross-cutting behavior:
 *  - Drawing the bar at UI scale in the canvas's label layer (see
 *    `label-layer.ts`), placed above the Layer from the live camera, so it
 *    keeps one crisp screen size at every zoom.
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
  worldX,
  worldY,
  zIndex,
  zoom,
  dragHandlers,
  onRequestReorderDrag,
  groupLabel,
  groupSelected,
  groupLabelDragHandlers,
  reorderDragTranslateX,
  reorderDragTranslateY,
  reorderDragPopped,
  children,
  tag,
}: LayerTitleBarProps) {
  // Far out, a label drops its menus and tag. Its chat stays wherever it
  // fits (see `LabelChat`).
  const compact = !showsLayerDetail(zoom)
  const labelFit = useMemo(
    () => ({ width: layerWidth * zoom, compact }),
    [layerWidth, zoom, compact]
  )
  // A group label runs the Group's width; the Layer's own rows run its own.
  const groupWidth = Math.max(layerWidth, groupLabel?.width ?? 0)
  const groupFit = useMemo(
    () => ({ width: groupWidth * zoom, compact }),
    [groupWidth, zoom, compact]
  )
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

  const labelLayer = useContext(LabelLayerContext)
  const barRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const groupRowRef = useRef<HTMLDivElement>(null)
  // What `place` reads, kept current on every render so a camera frame (which
  // renders nothing) positions the label from the latest Layer geometry.
  const geometry = useRef({
    worldX,
    worldY,
    dx: reorderDragTranslateX ?? 0,
    dy: reorderDragTranslateY ?? 0,
    layerWidth,
    groupWidth,
    tag: !!tag,
  })
  useLayoutEffect(() => {
    geometry.current = {
      worldX,
      worldY,
      dx: reorderDragTranslateX ?? 0,
      dy: reorderDragTranslateY ?? 0,
      layerWidth,
      groupWidth,
      tag: !!tag,
    }
  })
  // Put the label's bottom-left 4px above the Layer's top-left on screen, at
  // whole device pixels, and size its rows to the Layer's on-screen width.
  // Style writes only: this runs on every camera frame mid-pan and mid-zoom.
  const place = useCallback(() => {
    const bar = barRef.current
    if (!bar || !labelLayer) return
    const { x, y, zoom: z } = labelLayer.camera.get()
    const g = geometry.current
    const dpr = window.devicePixelRatio || 1
    const left = snapToDevicePixel(x + (g.worldX + g.dx) * z, dpr)
    const bottom = snapToDevicePixel(y + (g.worldY + g.dy) * z, dpr)
    bar.style.transform = `translate(${left}px, ${bottom - LABEL_GAP}px) translateY(-100%)`
    // Hidden, not unmounted, so measurements and rename state survive. Set
    // from the live zoom, so a label goes as its Layer passes the width, not
    // once the zoom settles.
    bar.style.visibility = showsLayerLabel(g.layerWidth, z) ? "" : "hidden"
    bar.style.maxWidth = `${g.groupWidth * z}px`
    bar.style.width = g.tag ? `${g.layerWidth * z}px` : ""
    if (rowsRef.current)
      rowsRef.current.style.maxWidth = `${g.layerWidth * z}px`
    if (groupRowRef.current)
      groupRowRef.current.style.maxWidth = `${g.groupWidth * z}px`
  }, [labelLayer])
  useLayoutEffect(place)
  useEffect(() => labelLayer?.camera.subscribe(place), [labelLayer, place])

  // Off the canvas (no label layer: tests, play mode), the label sits in
  // the Layer's own box and counter-scales with the deferred zoom.
  const inline = !labelLayer
  const groupDragTranslate =
    reorderDragTranslateX != null || reorderDragTranslateY != null
      ? `translate(${-(reorderDragTranslateX ?? 0) * zoom}px, ${-(reorderDragTranslateY ?? 0) * zoom}px)`
      : undefined

  const bar = (
    <LabelFitContext.Provider value={labelFit}>
      <div
        ref={barRef}
        {...{ [LAYER_LABEL_ATTRIBUTE]: layerId }}
        className={cn(
          "canvas-frame-label group/title-bar absolute left-0 flex flex-col items-start whitespace-nowrap",
          inline ? "bottom-full" : "top-0",
          // With a tag the bar spans the layer so the tag sits at its right
          // edge; only its contents take the pointer, not the gap between them.
          tag ? "pointer-events-none" : "pointer-events-auto",
          inline && !showsLayerLabel(layerWidth, zoom) && "invisible"
        )}
        style={
          inline
            ? {
                transform: `scale(${1 / zoom})`,
                transformOrigin: "bottom left",
                maxWidth: groupWidth * zoom,
                width: tag ? layerWidth * zoom : undefined,
                marginBottom: LABEL_GAP / zoom,
              }
            : // Position and widths are written by `place`, per camera frame.
              // Paint order among labels follows the Layers'.
              { zIndex }
        }
        data-compact={compact ? "" : undefined}
        {...labelDragHandlers}
      >
        {groupLabel && !reorderDragPopped && (
          <div
            ref={groupRowRef}
            className="pointer-events-auto"
            style={{
              maxWidth: inline ? groupWidth * zoom : undefined,
              // The Layer (and so this label) is dragged `translate(dx, dy)` in
              // world units; the Group's label stays at the source Group's
              // origin, so undo the drag here in screen px.
              transform: groupDragTranslate,
            }}
          >
            <LabelFitContext.Provider value={groupFit}>
              <GroupLabel
                label={groupLabel.label}
                workspace={groupLabel.workspace}
                groupSelected={groupSelected}
                color={groupLabel.remoteSelectedColor}
                onSelectGroup={groupLabel.onSelect}
                onRename={groupLabel.onRename}
                menu={compact ? undefined : groupLabel.menu}
                dragHandlers={groupLabelDragHandlers}
              />
            </LabelFitContext.Provider>
          </div>
        )}
        {tag ? (
          <div className="flex w-full items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col items-start *:pointer-events-auto">
              {children}
            </div>
            <div className="pointer-events-auto shrink-0 group-data-compact/title-bar:hidden">
              {tag}
            </div>
          </div>
        ) : (
          <div
            ref={rowsRef}
            className="flex flex-col items-start"
            style={{ maxWidth: inline ? layerWidth * zoom : undefined }}
          >
            {children}
          </div>
        )}
      </div>
    </LabelFitContext.Provider>
  )
  return inline ? bar : createPortal(bar, labelLayer.element)
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
  /** The rename field's handle, so a menu's Rename can start it. */
  editableRef?: Ref<EditableTextHandle>
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
  editableRef,
}: LayerTitleTextProps) {
  // Local selection (the canvas selection token) wins; a remote selector's color applies only
  // when we haven't selected the layer ourselves.
  const remoteColor = !selected && color ? color : undefined
  const colorClass = selected
    ? "text-canvas-selection"
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
        ref={editableRef}
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
        viewClassName="cursor-grab truncate active:cursor-grabbing"
        editClassName={cn(
          editableTextFieldClass,
          "-mx-0.5 -my-0.5 min-w-0 flex-1 px-0.5 py-0.5"
        )}
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

interface LayerLabelRowProps extends LayerTitleTextProps {
  /** Content before the name. */
  leading?: React.ReactNode
  /** Content after the name: its `LabelChat`, then its menu. */
  trailing?: React.ReactNode
  style?: React.CSSProperties
}

/**
 * The row under a layer's group label: the layer's name with optional content
 * either side. Frames and Documents both render their title through this, so
 * the two kinds of label share one height, gap, and clipping rule.
 *
 * The row clips to the title bar's max-width so the name truncates, except
 * while the name is being edited, when the input may run past it.
 */
export function LayerLabelRow({
  leading,
  trailing,
  style,
  ...titleProps
}: LayerLabelRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const chatHidden = useLabelChatHidden(rowRef)
  return (
    <div
      ref={rowRef}
      className="group/layer-label flex min-h-[18px] max-w-full items-center gap-2 overflow-hidden has-[[data-editable-text=editing]]:overflow-visible has-[[data-label-chat]]:min-h-5"
      style={style}
      data-chat-hidden={chatHidden ? "" : undefined}
    >
      {leading}
      <LayerTitleText {...titleProps} />
      {trailing}
    </div>
  )
}
