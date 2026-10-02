"use client"

import { useCallback } from "react"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { useMockupHtml } from "@/lib/yjs/react"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"
import { LayerLabelRow } from "@/components/canvas/layer-title-bar"
import {
  LayerShell,
  LAYER_SURFACE_CLASS,
} from "@/components/canvas/layer-shell"
import type { MockupLayerData, MockupStatus } from "@/lib/types"
import { mockupStatusOf } from "@/lib/mockup-status"
import { MockupStatusMenu } from "@/components/canvas/mockup-status-menu"
import type { GroupWorkspace } from "@/components/canvas/group-label"
import type { FrameWorkspace } from "@/components/canvas/frame-nav"
import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"
import { MaybeWorkspaceHoverCard } from "@/components/workspace-hover-card"

type Mover = (
  dx: number,
  dy: number,
  totalDx: number,
  totalDy: number,
  metaKey: boolean
) => void

interface MockupLayerProps {
  layer: MockupLayerData
  /**
   * The Workspace of the chat that made it (#1309), named after its title
   * unless the group label names it.
   */
  ownerWorkspace?: FrameWorkspace
  zoom: number
  selected: boolean
  multiSelected: boolean
  spaceHeld: boolean
  /** Absolute world-space top-left, from `effectiveIframeLayerLayouts`. */
  worldX: number
  worldY: number
  zIndex?: number
  dragTranslateX?: number
  dragTranslateY?: number
  dragPopped?: boolean
  /** Group display name — only set on the leftmost member of a multi-member group. */
  groupLabel?: string
  groupWorkspace?: GroupWorkspace
  groupSelected?: boolean
  remoteSelectedColor?: string
  remoteGroupSelectedColor?: string
  onSelectGroup?: (shiftKey: boolean) => void
  onRenameGroup?: (next: string) => void
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onMoveGroup: Mover
  onMoveSelected: Mover
  onGroupDragStart?: () => void
  onGroupDragEnd?: (metaKey: boolean) => void
  /** Adjust the mockup's own box; the Group anchor shifts for left/top edges. */
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onRename: (id: string, title: string) => void
  onSetStatus: (id: string, status: MockupStatus) => void
}

/**
 * The Mockup Layer (#1309) — a static HTML page a chat wrote, plugged into
 * the shared {@link LayerShell} as its third content adapter. The page renders
 * in an `<iframe srcdoc>` sandboxed to `allow-scripts` only: without
 * `allow-same-origin` it runs in an opaque origin, so it can never reach the
 * app, its cookies or the canvas, and its Content Security Policy
 * (`mockupSrcDoc`) keeps it from loading anything from the network. There is
 * no address bar, reload or Interact: it is a picture, not a running app. A transparent overlay sits over the page so
 * a press selects and drags the mockup like any other layer.
 */
export function MockupLayer({
  layer,
  ownerWorkspace,
  zoom,
  selected,
  multiSelected,
  spaceHeld,
  worldX,
  worldY,
  zIndex,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
  groupLabel,
  groupWorkspace,
  groupSelected,
  remoteSelectedColor,
  remoteGroupSelectedColor,
  onSelectGroup,
  onRenameGroup,
  onRequestReorderDrag,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onGroupDragStart,
  onGroupDragEnd,
  onResize,
  onRename,
  onSetStatus,
}: MockupLayerProps) {
  const html = useMockupHtml(layer.id)

  // A mockup snaps on neither axis, so drop the edge and forward the deltas.
  const handleResize = useCallback(
    (
      id: string,
      _edge: ResizeEdge,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ) => {
      onResize(id, dx, dy, dw, dh)
    },
    [onResize]
  )

  return (
    <LayerShell
      layerId={layer.id}
      width={layer.width}
      height={layer.height}
      worldX={worldX}
      worldY={worldY}
      zIndex={zIndex}
      dragTranslateX={dragTranslateX}
      dragTranslateY={dragTranslateY}
      dragPopped={dragPopped}
      containerId={`mockup-layer-${layer.id}`}
      // No overflow-hidden on the root: the title bar sits above the tile.
      containerClassName={`absolute flex flex-col bg-background ${LAYER_SURFACE_CLASS}`}
      containerProps={{ "data-mockup-layer": "" }}
      zoom={zoom}
      selected={selected}
      groupSelected={groupSelected}
      multiSelected={multiSelected}
      spaceHeld={spaceHeld}
      onSelect={onSelect}
      onMoveGroup={onMoveGroup}
      onMoveSelected={onMoveSelected}
      onGroupDragStart={onGroupDragStart}
      onGroupDragEnd={onGroupDragEnd}
      onRequestReorderDrag={onRequestReorderDrag}
      titleDragDisabled={spaceHeld}
      onResize={handleResize}
      groupLabel={groupLabel}
      groupWorkspace={groupWorkspace}
      remoteGroupSelectedColor={remoteGroupSelectedColor}
      onSelectGroup={onSelectGroup}
      onRenameGroup={onRenameGroup}
      renderTitle={(api) => (
        <LayerLabelRow
          style={{ maxWidth: layer.width * zoom }}
          title={layer.title}
          placeholder="Untitled"
          selected={selected || groupSelected}
          color={remoteSelectedColor}
          onSelectLayer={api.deferSelect}
          onRename={(next) => onRename(layer.id, next)}
          trailing={
            <>
              {ownerWorkspace && (
                <MaybeWorkspaceHoverCard
                  branchId={ownerWorkspace.branchId}
                  side="bottom"
                >
                  {/* The mention doesn't take the trigger's props; this span
                    does. Names win: the Workspace gives up its width first. */}
                  <span className="flex min-w-10 shrink-[100] text-xs text-muted-foreground">
                    <CompactWorkspaceMention workspace={ownerWorkspace} />
                  </span>
                </MaybeWorkspaceHoverCard>
              )}
              <MockupStatusMenu
                status={mockupStatusOf(layer)}
                onChange={(status) => onSetStatus(layer.id, status)}
              />
            </>
          }
        />
      )}
    >
      {(api) => (
        <div className="relative flex-1 overflow-hidden rounded-[inherit]">
          <iframe
            title={layer.title || "Mockup"}
            srcDoc={mockupSrcDoc(html)}
            // Scripts only: no same-origin, forms, popups or top navigation.
            sandbox="allow-scripts"
            className="pointer-events-none absolute inset-0 size-full border-0 bg-white"
            tabIndex={-1}
          />
          <div
            className="absolute inset-0 touch-none"
            style={{ cursor: "inherit" }}
            {...api.bodyDragHandlers}
            onPointerDownCapture={api.onBodyPointerDownCapture}
          />
        </div>
      )}
    </LayerShell>
  )
}
