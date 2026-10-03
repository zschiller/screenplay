"use client"

import { useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { FloatingToolbar } from "@workspace/ui/components/floating-toolbar"
import { canInteractOnDoubleClick } from "@/lib/canvas/interaction-mode"
import { drivenByOther } from "@/lib/canvas/frame-control"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { useMockupRuntime } from "@/hooks/use-mockup-runtime"
import { useIframeBridgePort } from "@/hooks/use-bridge-port"
import { usePostMessage } from "@/hooks/use-postmessage"
import {
  useScreenplayDom,
  type ScreenplayDom,
  type WheelForward,
} from "@/hooks/use-screenplay-dom"
import type { DomRect, JsonObject, JsonValue } from "@/lib/postmessage-protocol"
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
import { KnobsPopover } from "@/components/canvas/knobs-popover"
import { useDriveFrame } from "@/components/canvas/frame-drive-relay"
import {
  FrameDriverButton,
  FrameDriverTag,
} from "@/components/canvas/frame-driver"
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
  /**
   * True while a chat's element pick is armed and this mockup is one it can
   * hit (its chat's Workspace is the picker's): the overlay tracks the hovered
   * element. A mockup another chat made is `dimmed` instead.
   */
  pickActive?: boolean
  dimmed?: boolean
  /** The element under the pointer during a pick (null clears it). */
  onHover?: (id: string, rect: DomRect | null) => void
  /** Register the page's DOM bridge (null on unmount), as a frame does. */
  onDomReady?: (id: string, dom: ScreenplayDom | null) => void
  onKnobsDeclared?: (id: string, knobs: JsonValue[]) => void
  onKnobValuesChange?: (id: string, values: JsonObject) => void
  /** Start an "add a knob" request in the chat that made the mockup. */
  onAskForKnob?: () => void
  /** State the page shares through `screenplay.shareState` changed. */
  onSharedStateChanged?: (id: string, state: JsonObject) => void
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
  /** Comment placement owns the pointer, so a double-click doesn't Interact. */
  commentMode?: boolean
  /** A pinch or ⌘-scroll over the interacting page, to zoom the canvas. */
  onWheel?: (id: string, wheel: WheelForward) => void
}

const NOBODY_DRIVES: FrameDriverView = { kind: "none" }

// A mockup's page carries no app state; the bridge's handshake still sends one.
const NO_STATE: JsonObject = {}
const ignoreState = () => {}

/**
 * The Mockup Layer (#1309) — a static HTML page a chat wrote, plugged into
 * the shared {@link LayerShell} as its third content adapter. The page renders
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
 * with every viewer (`screenplay.shareState`), like a frame's app. Claude
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
  pickActive,
  dimmed,
  onHover,
  onDomReady,
  onKnobsDeclared,
  onKnobValuesChange,
  onAskForKnob,
  onSharedStateChanged,
  focused = false,
  driver = NOBODY_DRIVES,
  onFocus,
  commentMode = false,
  onWheel,
}: MockupLayerProps) {
  const html = useMockupHtml(layer.id)
  const runtime = useMockupRuntime()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  const port = useIframeBridgePort(iframeRef)
  usePostMessage({
    port,
    iframeLayerId: layer.id,
    iframeState: NO_STATE,
    knobValues: layer.knobValues,
    sharedState: layer.sharedState,
    onStateChanged: ignoreState,
    onKnobsDeclared,
    onSharedStateChanged,
  })

  const dom = useScreenplayDom(port, {
    onWheel: (wheel) => onWheel?.(layer.id, wheel),
    // Esc the page didn't claim, forwarded by the bridge because keydowns
    // never leave the iframe: replay it on the canvas so it leaves Interact.
    // Space pressed in the page with the pointer out over the canvas, so
    // space-drag pans the canvas as it does outside Interact.
    onSpaceDown: () => {
      if (!focused) return
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }))
    },
    onSpaceUp: () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }))
    },
    onEscape: () => {
      if (!focused) return
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    },
  })

  // Leaving Interact hands keyboard focus back to the canvas.
  useEffect(() => {
    if (focused) {
      // Entering from the toolbar leaves focus on the Interact button, where
      // Space would press it (leaving Interact) instead of panning the canvas.
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active.closest("#frame-toolbar-portal")
      )
        active.blur()
      return
    }
    const iframe = iframeRef.current
    if (iframe && document.activeElement === iframe) iframe.blur()
  }, [focused])
  const onDomReadyRef = useRef(onDomReady)
  useEffect(() => {
    onDomReadyRef.current = onDomReady
  })
  useEffect(() => {
    onDomReadyRef.current?.(layer.id, dom)
    return () => onDomReadyRef.current?.(layer.id, null)
  }, [layer.id, dom])
  // No browser can photograph a mockup in someone's canvas on hosted, so a
  // screenshot there is rendered from a read of the page.
  useDriveFrame(layer.id, dom, iframeRef, zoom, { snapshot: true })

  // The page lays out at the mockup's own size inside the zoomed canvas, so a
  // screen point maps back into it by dividing by zoom.
  const elementRectAt = useCallback(
    async (clientX: number, clientY: number) => {
      const iframe = iframeRef.current
      if (!iframe) return null
      const rect = iframe.getBoundingClientRect()
      const x = (clientX - rect.left) / zoom
      const y = (clientY - rect.top) / zoom
      if (x < 0 || y < 0 || x > layer.width || y > layer.height) return null
      try {
        return (await dom.elementAtPoint(x, y))?.rect ?? null
      } catch {
        return null
      }
    },
    [dom, zoom, layer.width, layer.height]
  )

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
      // An interacting mockup's edges belong to the page. Nor does one
      // someone else drives resize, so the size never changes under them.
      resizable={!focused && !drivenByOther(driver)}
      titleTag={
        drivenByOther(driver) ? <FrameDriverTag driver={driver} /> : undefined
      }
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
                <FrameDriverButton
                  driver={driver}
                  onClick={() => onFocus?.(focused ? null : layer.id)}
                />
                <KnobsPopover
                  knobs={layer.knobs}
                  values={layer.knobValues}
                  onChange={(values) => onKnobValuesChange?.(layer.id, values)}
                  onAskForKnob={onAskForKnob}
                />
              </FloatingToolbar>,
              toolbarTarget
            )}
          {!html.trim() ? null : runtime === null ? (
            // The runtime arrives once per session; until then the page waits
            // rather than load twice.
            <div className="pointer-events-none absolute inset-0 bg-white" />
          ) : (
            <iframe
              ref={iframeRef}
              title={layer.title || "Mockup"}
              srcDoc={mockupSrcDoc(html, runtime)}
              // Scripts only: no same-origin, forms, popups or top navigation.
              sandbox="allow-scripts"
              className="absolute inset-0 size-full border-0 bg-white"
              style={{ pointerEvents: focused ? "auto" : "none" }}
              tabIndex={focused ? 0 : -1}
            />
          )}
          {!html.trim() && (
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
          {/* A wash over a mockup another chat made while a pick is armed, as
            on a frame of another Workspace (#619). */}
          {dimmed && (
            <div className="pointer-events-none absolute inset-0 z-10 bg-background/60 transition-opacity" />
          )}
          {/* While interacting, the page takes the pointer instead. */}
          {!focused && (
            <div
              className="absolute inset-0 touch-none"
              style={{ cursor: "inherit" }}
              {...api.bodyDragHandlers}
              {...(pickActive && !spaceHeld && !dimmed
                ? {
                    // Hover-only: outline the element a click would target. The
                    // click itself goes to the canvas's pick handler.
                    onPointerMove: async (e: React.PointerEvent) => {
                      onHover?.(
                        layer.id,
                        await elementRectAt(e.clientX, e.clientY)
                      )
                    },
                    onPointerLeave: () => onHover?.(layer.id, null),
                  }
                : {})}
              onPointerDownCapture={api.onBodyPointerDownCapture}
              onDoubleClick={(e) => {
                if (
                  !onFocus ||
                  !canInteractOnDoubleClick({
                    hasPreview: !!html.trim(),
                    commentMode,
                    // A dimmed mockup is ineligible for an armed pick, but the
                    // pick still owns the pointer.
                    pickActive: !!pickActive || !!dimmed,
                    spaceHeld,
                  })
                )
                  return
                e.stopPropagation()
                onSelect(layer.id, false)
                onFocus(layer.id)
              }}
            />
          )}
        </div>
      )}
    </LayerShell>
  )
}
