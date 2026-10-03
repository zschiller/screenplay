"use client"

import { useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import {
  FloatingToolbar,
  FloatingToolbarButton,
} from "@workspace/ui/components/floating-toolbar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  CopyIcon,
  DotsThreeIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { useMockupRuntime } from "@/hooks/use-mockup-runtime"
import type { ScreenplayDom, WheelForward } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"
import { useMockupHtml } from "@/lib/yjs/react"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"
import { LayerLabelRow } from "@/components/canvas/layer-title-bar"
import {
  LayerShell,
  LAYER_SURFACE_CLASS,
} from "@/components/canvas/layer-shell"
import type { MockupLayerData, MockupStatus } from "@/lib/types"
import { mockupStatusOf } from "@/lib/mockup-status"
import {
  MockupStatusMark,
  MockupStatusMenu,
  MockupStatusRadioGroup,
  StatusIcon,
} from "@/components/canvas/mockup-status-menu"
import {
  LivePageContent,
  LivePageControls,
  LivePageOverlay,
  livePageChrome,
  useLivePage,
  type LivePageWrites,
} from "@/components/canvas/live-page"
import type { FrameDriverView } from "@/components/canvas/use-frame-control"
import { useLayerToolbar } from "@/components/canvas/use-layer-toolbar"
import type { GroupWorkspace } from "@/components/canvas/group-label"
import type { FrameWorkspace } from "@/components/canvas/frame-nav"
import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"
import { MaybeWorkspaceHoverCard } from "@/components/workspace-hover-card"
import { GripSpinner } from "@/components/grip-spinner"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

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
  /** The Canvas hides this Layer's label (see `hiddenLayerLabels`). */
  labelHidden?: boolean
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
  /** The bar's ⋯ Duplicate: a copy at the end of the mockup's Group. */
  onDuplicate?: (id: string) => void
  /** The bar's ⋯ Delete, the same removal as the Delete key (⌘Z undoes it). */
  onRemove?: (id: string) => void
  /**
   * True while a chat's element pick is armed and this mockup is one it can
   * hit (its chat's Workspace is the picker's): the overlay tracks the hovered
   * element. A mockup another chat made is `dimmed` instead.
   */
  pickActive?: boolean
  dimmed?: boolean
  /** The element under the pointer during a pick or comment (null clears it). */
  onHover?: (id: string, rect: DomRect | null) => void
  /** Register the page's DOM bridge (null on unmount), as a frame does. */
  onDomReady?: (id: string, dom: ScreenplayDom | null) => void
  /** Where the page's Knobs and shared state are written. */
  writes?: LivePageWrites
  /** Start an "add a knob" request in the chat that made the mockup. */
  onAskForKnob?: () => void
  /**
   * The mockup takes clicks, scrolls and keys (Interact), as a frame does:
   * the canvas stops panning over it and Esc returns.
   */
  focused?: boolean
  /**
   * Who drives the mockup (#1391), as on a frame: the agent drives it in the
   * asker's own view. The driver button, tag and ring show it.
   */
  driver?: FrameDriverView
  onFocus?: (id: string | null) => void
  /** Comment placement owns the pointer, so a double-click doesn't Interact,
   *  and the overlay tracks the element a comment would pin. */
  commentMode?: boolean
  /** A pinch or ⌘-scroll over the interacting page, to zoom the canvas. */
  onWheel?: (id: string, wheel: WheelForward) => void
}

const NOBODY_DRIVES: FrameDriverView = { kind: "none" }

/**
 * The Mockup Layer (#1309) — a static HTML page a chat wrote, plugged into
 * the shared {@link LayerShell} as its third content adapter, and a Live Page
 * (`./live-page`) from a `srcdoc` source, as a frame is from a URL. The page renders
 * in an `<iframe srcdoc>` sandboxed to `allow-scripts` only: without
 * `allow-same-origin` it runs in an opaque origin, so it can never reach the
 * app, its cookies or the canvas, and its Content Security Policy
 * (`mockupSrcDoc`) keeps it from loading anything from the network. There is
 * no address bar or reload. A transparent overlay sits over the page so a
 * press selects and drags the mockup like any other layer; Interact (the
 * toolbar button, or a double-click) lifts it so the page takes the pointer.
 *
 * Ahead of its own scripts the page runs the frames' DOM bridge and the knobs
 * and shared-state runtimes (`MOCKUP_RUNTIME_JS`), so its chat can target an
 * element in it, and the page can declare knobs (`screenplay.registerKnob`,
 * edited from the Knobs button under the selected mockup) and share state
 * with every viewer (`screenplay.shareState`), like a frame's app. The agent
 * drives it through the same bridge (#1391), in the asker's view only, and
 * the Interact button is the driver button, as on a frame.
 *
 * An empty page is a Mockup someone drew and sent to a chat (#1359) that the
 * chat hasn't filled yet, so it shows the model at work (the 9-dot).
 */
export function MockupLayer({
  layer,
  ownerWorkspace,
  zoom,
  labelHidden,
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
  onDuplicate,
  onRemove,
  pickActive,
  dimmed,
  onHover,
  onDomReady,
  writes,
  onAskForKnob,
  focused = false,
  driver = NOBODY_DRIVES,
  onFocus,
  commentMode = false,
  onWheel,
}: MockupLayerProps) {
  const html = useMockupHtml(layer.id)
  const runtime = useMockupRuntime()
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  const hasPage = !!html.trim()
  const page = useLivePage({
    id: layer.id,
    source: {
      kind: "srcdoc",
      // The runtime arrives once per session; until then the page waits
      // rather than load twice.
      srcDoc:
        hasPage && runtime !== null ? mockupSrcDoc(html, runtime) : undefined,
      title: layer.title || "Mockup",
    },
    record: layer,
    writes,
    interactive: focused,
    driver,
    zoom,
    width: layer.width,
    height: layer.height,
    onWheel,
    onDomReady,
    iframeRef,
    bodyRef,
    // No browser can photograph a mockup in someone's canvas on hosted, so a
    // screenshot there is rendered from a read of the page.
    snapshot: true,
  })
  const chrome = livePageChrome({ driver, focused })

  const toolbarTarget = useLayerToolbar({
    show: selected && !multiSelected,
    anchorRef: containerRef,
    toolbarRef,
  })

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
      containerRef={containerRef}
      // No overflow-hidden on the root: the title bar sits above the tile.
      containerClassName={`absolute flex flex-col bg-background ${LAYER_SURFACE_CLASS}`}
      containerProps={{ "data-mockup-layer": "" }}
      zoom={zoom}
      labelHidden={labelHidden}
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
      titleDragDisabled={spaceHeld || focused}
      resizable={chrome.resizable}
      titleTag={chrome.titleTag}
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
          struck={mockupStatusOf(layer) === "set-aside"}
          compactTrailing={<MockupStatusMark status={mockupStatusOf(layer)} />}
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
        <div
          ref={bodyRef}
          className="relative flex-1 overflow-hidden rounded-[inherit]"
        >
          {toolbarTarget &&
            createPortal(
              <FloatingToolbar
                ref={toolbarRef}
                aria-label="Mockup"
                // Positioned every frame by useLayerToolbar, outside the world
                // transform, so it's already at constant screen size.
                className="absolute top-0 left-0"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <LivePageControls
                  page={page}
                  focused={focused}
                  onFocus={onFocus}
                  onAskForKnob={onAskForKnob}
                />
                {/* Trailing ⋯, as on the frame bar (H2): the menu is the
                  only home for these, no right-click menu. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <FloatingToolbarButton label="More">
                      <DotsThreeIcon className="text-muted-foreground" />
                    </FloatingToolbarButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="end" sideOffset={8}>
                    {onDuplicate && (
                      <DropdownMenuItem onSelect={() => onDuplicate(layer.id)}>
                        <CopyIcon />
                        Duplicate
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <StatusIcon status={mockupStatusOf(layer)} />
                        Status
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <MockupStatusRadioGroup
                          status={mockupStatusOf(layer)}
                          onChange={(status) => onSetStatus(layer.id, status)}
                        />
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {onRemove && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onRemove(layer.id)}
                        >
                          <TrashIcon />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </FloatingToolbar>,
              toolbarTarget
            )}
          {hasPage && runtime === null ? (
            <div className="pointer-events-none absolute inset-0 bg-white" />
          ) : (
            <LivePageContent page={page} iframeRef={iframeRef} />
          )}
          {!hasPage && (
            <Empty
              data-mockup-sketching=""
              className="pointer-events-none absolute inset-0 gap-3 rounded-none bg-white dark:bg-neutral-900"
            >
              <EmptyHeader>
                <EmptyMedia variant="icon" className="mb-1">
                  <GripSpinner className="text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>Sketching</EmptyTitle>
                <EmptyDescription className="text-xs/relaxed">
                  The chat is drawing this page.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <LivePageOverlay
            page={page}
            api={api}
            hasPage={hasPage}
            commentMode={commentMode}
            pickActive={pickActive}
            dimmed={dimmed}
            spaceHeld={spaceHeld}
            onHover={onHover}
            onSelect={onSelect}
            onFocus={onFocus}
          />
        </div>
      )}
    </LayerShell>
  )
}
