"use client"

import { useCallback, useMemo, useRef } from "react"
import { useLayerDrag, type LayerDragHandlers } from "@/hooks/use-layer-drag"
import { useLayerResize, type ResizeEdge } from "@/hooks/use-layer-resize"
import {
  shouldMoveSelection,
  shouldSelectOnPointerDown,
} from "@/lib/canvas/layer-shell"
import { LayerTitleBar } from "./layer-title-bar"
import { ResizeHandles } from "./resize-handles"

/** Move callback shared by `onMoveGroup` / `onMoveSelected`. */
type Mover = (
  dx: number,
  dy: number,
  totalDx: number,
  totalDy: number,
  metaKey: boolean
) => void

/**
 * Gesture wiring the Shell hands to its content adapter so the adapter's body
 * and title rows participate in the shared selection/drag without
 * re-implementing any of it.
 */
export interface LayerShellApi {
  /**
   * Move-drag handlers for the body overlay, already gated on `spaceHeld`
   * (`undefined` while the user holds space to pan). Spread onto the overlay so
   * a press-drag moves the group/selection and a press-release falls through to
   * the deferred click-to-select.
   */
  bodyDragHandlers: LayerDragHandlers | undefined
  /**
   * Pointer-down-capture for the body overlay implementing the deferred
   * click-to-select decision (`shouldSelectOnPointerDown`).
   */
  onBodyPointerDownCapture: (e: React.PointerEvent) => void
  /**
   * Title-text instant-select: mark the pending click as already-consumed, then
   * select now. Used by the adapter's title row so clicking the name feels
   * identical to clicking the body.
   */
  deferSelect: (shiftKey: boolean) => void
}

interface LayerShellProps {
  // ── Identity & world-space container ───────────────────────────────────────
  layerId: string
  width: number
  height: number
  /** Absolute world-space position of the layer's top-left. */
  worldX: number
  worldY: number
  /** Paint order, projected from the group's sidebar position. */
  zIndex?: number
  /** In-flow reorder translate (world px), layered on top of `worldX/worldY`. */
  dragTranslateX?: number
  dragTranslateY?: number
  /** True while this layer is the one being "popped" out at the cursor. */
  dragPopped?: boolean
  /** DOM id for the container (e.g. `iframe-layer-${id}`). */
  containerId: string
  /** Container className — the adapter owns the visual frame (bg, rounding). */
  containerClassName: string
  /** Forwarded to the container div so the adapter can anchor portals/queries. */
  containerRef?: React.Ref<HTMLDivElement>
  /** Extra container attributes (data-* markers, onDoubleClick, …). */
  containerProps?: React.HTMLAttributes<HTMLDivElement> & {
    [key: `data-${string}`]: string | boolean | undefined
  }

  // ── Zoom & selection ───────────────────────────────────────────────────────
  zoom: number
  selected: boolean
  groupSelected?: boolean
  multiSelected: boolean
  spaceHeld: boolean
  onSelect: (id: string, shiftKey: boolean) => void

  // ── Drag routing ───────────────────────────────────────────────────────────
  onMoveGroup: Mover
  onMoveSelected: Mover
  onGroupDragStart?: () => void
  onGroupDragEnd?: (metaKey: boolean) => void
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  /**
   * Detach drag handlers from the title bar. The body overlay's own presence is
   * the adapter's call (it hides the overlay entirely in interactive/edit
   * modes), but the title bar always renders, so the Shell needs to know when
   * its drag should be inert — Iframe passes `interactive`, Markdown `spaceHeld`.
   */
  titleDragDisabled?: boolean

  // ── Resize ─────────────────────────────────────────────────────────────────
  onResize: (
    id: string,
    edge: ResizeEdge,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => void
  onResizeStart?: (id: string, edge: ResizeEdge) => void
  onResizeEnd?: (id: string) => void
  /** Whether resize handles render when singly selected (Markdown: `!editing`). */
  resizable?: boolean

  // ── Title bar ──────────────────────────────────────────────────────────────
  groupLabel?: string
  /** Remote selector's color for the group label. */
  remoteGroupSelectedColor?: string
  onSelectGroup?: (shiftKey: boolean) => void
  onRenameGroup?: (next: string) => void
  /** Layer-specific title row rendered inside the shared `LayerTitleBar`. */
  renderTitle: (api: LayerShellApi) => React.ReactNode

  // ── Body ───────────────────────────────────────────────────────────────────
  /** Layer-specific content rendered inside the world-space container. */
  children: (api: LayerShellApi) => React.ReactNode
}

/**
 * Layer Shell — the canvas frame wrapping either Layer kind (Iframe / Markdown;
 * see `apps/app/CONTEXT.md`). It owns the world-space container, the selection
 * wiring, the drag (group-move / merge routing plus deferred click-to-select),
 * the resize handles, and the `LayerTitleBar`. A content adapter plugs in by
 * supplying the title row (`renderTitle`) and the body (`children`), each
 * receiving a {@link LayerShellApi} that threads the shared gesture handlers
 * back through the adapter's own DOM.
 *
 * Content-specific behavior (dev-server probe, route picker, TipTap editor,
 * inline-comment bubble, …) stays in the adapter — the Shell is generic.
 */
export function LayerShell({
  layerId,
  width,
  height,
  worldX,
  worldY,
  zIndex,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
  containerId,
  containerClassName,
  containerRef,
  containerProps,
  zoom,
  selected,
  groupSelected,
  multiSelected,
  spaceHeld,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onGroupDragStart,
  onGroupDragEnd,
  onRequestReorderDrag,
  titleDragDisabled,
  onResize,
  onResizeStart,
  onResizeEnd,
  resizable = true,
  groupLabel,
  remoteGroupSelectedColor,
  onSelectGroup,
  onRenameGroup,
  renderTitle,
  children,
}: LayerShellProps) {
  // `groupSelected` routes through the selection mover too, so grabbing a
  // selected group (its label or any member) drags the whole selection —
  // including other selected groups and loose layers — not just this group.
  const handleDrag = useCallback<Mover>(
    (dx, dy, totalDx, totalDy, metaKey) => {
      if (shouldMoveSelection({ selected, groupSelected: !!groupSelected })) {
        onMoveSelected(dx, dy, totalDx, totalDy, metaKey)
      } else {
        onMoveGroup(dx, dy, totalDx, totalDy, metaKey)
      }
    },
    [selected, groupSelected, onMoveGroup, onMoveSelected]
  )

  // Set on pointer-down when the press already applied selection, so the
  // following click (which a release-without-movement synthesizes) doesn't
  // re-toggle it.
  const selectedOnPointerDown = useRef(false)

  const dragHandlers = useLayerDrag({
    zoom,
    onDrag: handleDrag,
    onDragStart: onGroupDragStart,
    onDragEnd: onGroupDragEnd,
    onClick: (e) => {
      if (selectedOnPointerDown.current) {
        selectedOnPointerDown.current = false
        return
      }
      onSelect(layerId, e.shiftKey)
    },
  })

  // Separate drag handlers for the *group* label — dragging it translates the
  // whole group (like the body) but a release without movement does NOT fall
  // through to `onSelect` (group selection was already applied on pointerdown).
  // Reuses `handleDrag` so the snap-merge routing still kicks in.
  const groupLabelDragHandlers = useLayerDrag({
    zoom,
    onDrag: handleDrag,
    onDragStart: onGroupDragStart,
    onDragEnd: onGroupDragEnd,
  })

  const handleResize = useCallback(
    (edge: ResizeEdge, dx: number, dy: number, dw: number, dh: number) => {
      onResize(layerId, edge, dx, dy, dw, dh)
    },
    [layerId, onResize]
  )

  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => {
      onResizeStart?.(layerId, edge)
    },
    [layerId, onResizeStart]
  )

  const handleResizeEnd = useCallback(() => {
    onResizeEnd?.(layerId)
  }, [layerId, onResizeEnd])

  const { makeHandleProps } = useLayerResize({
    zoom,
    onResize: handleResize,
    onResizeStart: handleResizeStart,
    onResizeEnd: handleResizeEnd,
  })

  const deferSelect = useCallback(
    (shiftKey: boolean) => {
      selectedOnPointerDown.current = true
      onSelect(layerId, shiftKey)
    },
    [layerId, onSelect]
  )

  const onBodyPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || spaceHeld) return
      selectedOnPointerDown.current = false
      if (
        shouldSelectOnPointerDown({
          selected,
          groupSelected: !!groupSelected,
          shiftKey: e.shiftKey,
        })
      ) {
        selectedOnPointerDown.current = true
        onSelect(layerId, e.shiftKey)
      }
    },
    [spaceHeld, selected, groupSelected, layerId, onSelect]
  )

  const api = useMemo<LayerShellApi>(
    () => ({
      bodyDragHandlers: spaceHeld ? undefined : dragHandlers,
      onBodyPointerDownCapture,
      deferSelect,
    }),
    [spaceHeld, dragHandlers, onBodyPointerDownCapture, deferSelect]
  )

  // Group-label click applies the group selection on pointerdown; mark the
  // pending click consumed so a release-without-movement doesn't fall through.
  const handleSelectGroup = useMemo(() => {
    if (!onSelectGroup) return undefined
    return (shiftKey: boolean) => {
      selectedOnPointerDown.current = true
      onSelectGroup(shiftKey)
    }
  }, [onSelectGroup])

  return (
    <div
      ref={containerRef}
      id={containerId}
      className={containerClassName}
      style={{
        width,
        height,
        // Flat, absolutely-positioned in world space. Moving between groups
        // only changes `worldX/worldY`, never the React parent, so the layer's
        // content (iframe element / TipTap editor) is never unmounted.
        left: worldX,
        top: worldY,
        transform:
          dragTranslateX != null || dragTranslateY != null
            ? `translate(${dragTranslateX ?? 0}px, ${dragTranslateY ?? 0}px)`
            : undefined,
        // Dragged/popped layer floats above its siblings; otherwise paint order
        // follows the group's sidebar position.
        zIndex:
          dragPopped || dragTranslateX != null || dragTranslateY != null
            ? 9999
            : zIndex,
        // The lifted layer is non-interactive so drop hit-testing falls through
        // to whatever sits beneath the cursor.
        pointerEvents:
          dragPopped || dragTranslateX != null || dragTranslateY != null
            ? "none"
            : "auto",
      }}
      {...containerProps}
    >
      <LayerTitleBar
        layerId={layerId}
        layerWidth={width}
        zoom={zoom}
        dragHandlers={titleDragDisabled ? undefined : dragHandlers}
        onRequestReorderDrag={onRequestReorderDrag}
        groupLabel={groupLabel}
        groupSelected={groupSelected}
        groupSelectedColor={remoteGroupSelectedColor}
        onSelectGroup={handleSelectGroup}
        onRenameGroup={onRenameGroup}
        groupLabelDragHandlers={
          titleDragDisabled ? undefined : groupLabelDragHandlers
        }
        reorderDragTranslateX={dragTranslateX}
        reorderDragTranslateY={dragTranslateY}
        reorderDragPopped={dragPopped}
      >
        {
          // `api`'s handlers (`deferSelect`, `onBodyPointerDownCapture`) read
          // `selectedOnPointerDown.current` only from event handlers the adapter
          // attaches — never during render — so threading `api` through the
          // render props is safe. The rule can't see that the access is deferred.
          // eslint-disable-next-line react-hooks/refs
          renderTitle(api)
        }
      </LayerTitleBar>

      {
        // See the note on `renderTitle(api)` above — same deferred-ref access.
        // eslint-disable-next-line react-hooks/refs
        children(api)
      }

      {/* Resize handles — only when singly selected. */}
      {selected && !multiSelected && resizable && (
        <ResizeHandles zoom={zoom} makeHandleProps={makeHandleProps} />
      )}
    </div>
  )
}
