"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  FloatingToolbar,
  FloatingToolbarButton,
} from "@workspace/ui/components/floating-toolbar"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { EditableTextHandle } from "@workspace/ui/components/editable-text"
import { DotsThreeIcon } from "@workspace/ui/components/icons"
import { type ResizeEdge } from "@/hooks/use-layer-resize"
import { useMockupRefs } from "@/hooks/use-mockup-refs"
import { useMockupRuntime } from "@/hooks/use-mockup-runtime"
import { useMockupQuestion, usePageQuestion } from "@/hooks/use-mockup-question"
import type { MockupQuestion } from "@/lib/agent/question"
import type { ScreenplayDom, WheelForward } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"
import { useMockupHtml } from "@/lib/yjs/react"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"
import { LayerLabelRow } from "@/components/canvas/layer-title-bar"
import {
  LayerMenuContent,
  useRegisterLayerMenu,
  type LayerMenuActions,
} from "@/components/canvas/layer-menu"
import {
  LayerShell,
  LAYER_SURFACE_CLASS,
} from "@/components/canvas/layer-shell"
import type { MockupLayerData } from "@/lib/types"
import {
  LivePageContent,
  LivePageControls,
  LivePageOverlay,
  livePageChrome,
  useLivePage,
  type LivePageWrites,
} from "@/components/canvas/live-page"
import type {
  FrameDriverView,
  FrameRequesterView,
} from "@/components/canvas/use-frame-control"
import type { FrameStreamConnection } from "@/lib/frame-stream/client"
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
  /** The Group's menu, on its label while it alone is selected (I7). */
  groupMenu?: LayerMenuActions
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onMoveGroup: Mover
  onMoveSelected: Mover
  onGroupDragStart?: () => void
  onGroupDragEnd?: (metaKey: boolean) => void
  /** Adjust the mockup's own box; the Group anchor shifts for left/top edges. */
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onRename: (id: string, title: string) => void
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
   * The page's `screenplay.draft(text)` (#1645): put `text` in the composer of
   * the chat that made the mockup. Called only for a tap this viewer made.
   */
  onDraft?: (id: string, text: string) => void
  /**
   * The page answered the question its chat asked about it (#1644,
   * `screenplay.answer`), as a click on the card would.
   */
  onAnswerQuestion?: (found: MockupQuestion, index: number) => void
  /**
   * The mockup takes clicks, scrolls and keys (Interact), as a frame does:
   * the canvas stops panning over it and Esc returns.
   */
  focused?: boolean
  /**
   * Who drives the mockup (#1391), as on a frame: the agent drives it in the
   * asker's own view, or the live page. The driver button, tag and ring show
   * it.
   */
  driver?: FrameDriverView
  /** This viewer asked the person driving the live mockup for control. */
  askedForControl?: boolean
  /** People asking this viewer, the driver, for control. */
  controlRequests?: readonly FrameRequesterView[]
  onGrantControl?: (id: string, to: string) => void
  onDeclineControl?: (id: string, to: string) => void
  /** This viewer's input reached the live page (Frame Control's idle clock). */
  onControlActivity?: (id: string) => void
  /**
   * Set while this viewer sees the mockup live (#1523): its page runs in one
   * browser in a Workspace's Sandbox, shown from that Workspace's Frame
   * Stream, as a live frame's does.
   */
  sharedStream?: FrameStreamConnection
  /** Someone turned the mockup live, for everyone. */
  live?: boolean
  /** Who drives the live page, for the title-line tag and the resize
   *  handles. */
  liveDriver?: FrameDriverView
  /**
   * Go live or end it, for everyone (the Go live toggle). Absent where
   * mockups can't go live: the desktop app, `SHARED_FRAMES=off`.
   */
  onToggleLive?: () => void
  /** No Workspace is running to host the live page: the toggle is disabled
   *  and says so. */
  liveUnavailable?: boolean
  /** This viewer turned it live and waits for its first picture (#1520). */
  liveStarting?: boolean
  /** The page scrolled: every copy follows, and it restores on load. */
  onScrollChange?: (id: string, scrollX: number, scrollY: number) => void
  /** The live page's Theme knob. */
  onColorSchemeChange?: (id: string, scheme: "light" | "dark") => void
  onFocus?: (id: string | null) => void
  /** Comment placement owns the pointer, so a double-click doesn't Interact,
   *  and the overlay tracks the element a comment would pin. */
  commentMode?: boolean
  /** A pinch or ⌘-scroll over the interacting page, to zoom the canvas. */
  onWheel?: (id: string, wheel: WheelForward) => void
}

const NOBODY_DRIVES: FrameDriverView = { kind: "none" }
const ignoreRoute = () => {}
const ignoreLive = () => {}

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
 * On hosted, Go live (#1523) runs the page in one browser in a Workspace's
 * Sandbox and streams it to everyone on the canvas, as a live frame's is
 * (#1516): everyone sees, and the agent drives, the same page, and a change
 * to the HTML shows in it.
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
  groupMenu,
  onRequestReorderDrag,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onGroupDragStart,
  onGroupDragEnd,
  onResize,
  onRename,
  onDuplicate,
  onRemove,
  pickActive,
  dimmed,
  onHover,
  onDomReady,
  writes,
  onAskForKnob,
  onDraft,
  onAnswerQuestion,
  focused = false,
  driver = NOBODY_DRIVES,
  askedForControl,
  controlRequests,
  onGrantControl,
  onDeclineControl,
  onControlActivity,
  sharedStream,
  live = false,
  liveDriver = NOBODY_DRIVES,
  onToggleLive,
  liveUnavailable = false,
  liveStarting = false,
  onScrollChange,
  onColorSchemeChange,
  onFocus,
  commentMode = false,
  onWheel,
}: MockupLayerProps) {
  const html = useMockupHtml(layer.id)
  const runtime = useMockupRuntime()
  const resources = useMockupRefs(layer.id, html)
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  const hasPage = !!html.trim()
  // The runtime arrives once per session, and the page's `skill:` and
  // `files:` references (#1643) once they resolve; until then the page waits
  // rather than load twice.
  const ready = runtime !== null && resources !== null
  const builtDoc = useMemo(
    () =>
      hasPage && runtime !== null && resources !== null
        ? mockupSrcDoc(html, runtime, resources)
        : undefined,
    [hasPage, html, runtime, resources]
  )
  // A change that names new references keeps the page shown until they
  // resolve.
  const [shownDoc, setShownDoc] = useState(builtDoc)
  const settled = builtDoc !== undefined || !hasPage
  if (settled && shownDoc !== builtDoc) setShownDoc(builtDoc)
  const srcDoc = settled ? builtDoc : shownDoc
  const shared = !!sharedStream
  // A draft speaks for the person, so it counts only from a tap this viewer
  // made: in their own copy while they Interact and the agent isn't driving
  // it, or in the live page while they have control. The runtime checks for
  // the tap too, but page script could post the message itself.
  const draftFromViewer = shared
    ? liveDriver.kind === "you"
    : focused && driver.kind !== "agent"
  const handleDraft = useCallback(
    (id: string, text: string) => {
      if (draftFromViewer) onDraft?.(id, text)
    },
    [draftFromViewer, onDraft]
  )
  const page = useLivePage({
    id: layer.id,
    // This viewer's own iframe, or the live page's stream.
    source: sharedStream
      ? {
          kind: "stream",
          stream: sharedStream,
          hasPage: srcDoc !== undefined,
          route: "/",
          scheme: layer.colorScheme ?? "light",
          doc: srcDoc,
          // A Mockup has one page: nowhere to navigate.
          onRoute: ignoreRoute,
          onLive: ignoreLive,
          onActivity: onControlActivity
            ? () => onControlActivity(layer.id)
            : undefined,
        }
      : { kind: "srcdoc", srcDoc, title: layer.title || "Mockup" },
    record: layer,
    writes,
    // Scroll syncs between copies, as a frame's does (#1563).
    app: { onScroll: onScrollChange, onDraft: handleDraft },
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
  // The question its chat asked about it (#1644). The page answers only
  // while this viewer interacts with it and the agent isn't driving it: page
  // script can post an answer without the runtime's tap check, and the agent
  // mustn't answer its own question. A live page is one page every viewer's
  // canvas hears from, so it shows the question but can't answer it: each
  // viewer would send the answer again.
  const question = useMockupQuestion(layer.id, layer.ownerChatId)
  const canAnswer = focused && driver.kind !== "agent" && !shared
  usePageQuestion(page.port, question, canAnswer ? onAnswerQuestion : undefined)

  const chrome = livePageChrome({
    driver,
    focused,
    live,
    liveDriver,
    onLiveCopy: shared,
  })

  const toolbarTarget = useLayerToolbar({
    show: selected && !multiSelected,
    anchorRef: containerRef,
    toolbarRef,
  })

  // The mockup's one menu (I7), in the bar's … and its sidebar row's ….
  const titleEditableRef = useRef<EditableTextHandle>(null)
  const menuActions: LayerMenuActions = {
    noun: "mockup",
    onDuplicate: onDuplicate ? () => onDuplicate(layer.id) : undefined,
    onDelete: () => onRemove?.(layer.id),
  }
  useRegisterLayerMenu(layer.id, menuActions)

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
      groupMenu={groupMenu}
      renderTitle={(api) => (
        <LayerLabelRow
          editableRef={titleEditableRef}
          style={{ maxWidth: layer.width * zoom }}
          title={layer.title}
          placeholder="Untitled"
          selected={selected || groupSelected}
          color={remoteSelectedColor}
          onSelectLayer={api.deferSelect}
          onRename={(next) => onRename(layer.id, next)}
          trailing={
            ownerWorkspace && (
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
            )
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
                  askedForControl={askedForControl}
                  controlRequests={controlRequests}
                  onGrantControl={onGrantControl}
                  onDeclineControl={onDeclineControl}
                  live={live}
                  onToggleLive={onToggleLive}
                  liveUnavailable={liveUnavailable}
                  liveStarting={liveStarting}
                  onAskForKnob={onAskForKnob}
                  theme={
                    shared && onColorSchemeChange
                      ? {
                          value: layer.colorScheme ?? "light",
                          onChange: (scheme) =>
                            onColorSchemeChange(layer.id, scheme),
                        }
                      : undefined
                  }
                />
                {/* Trailing ⋯, as on the frame bar (H2): the menu is the
                  only home for these, no right-click menu. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <FloatingToolbarButton label="More">
                      <DotsThreeIcon className="text-muted-foreground" />
                    </FloatingToolbarButton>
                  </DropdownMenuTrigger>
                  <LayerMenuContent
                    actions={menuActions}
                    onRename={() => titleEditableRef.current?.startEditing()}
                    side="bottom"
                    align="end"
                    sideOffset={8}
                  />
                </DropdownMenu>
              </FloatingToolbar>,
              toolbarTarget
            )}
          {hasPage && srcDoc === undefined && !ready ? (
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
