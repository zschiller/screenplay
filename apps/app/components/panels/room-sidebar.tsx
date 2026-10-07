"use client"

import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"

import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"

import {
  CaretRightIcon,
  FolderIcon,
  FolderOpenIcon,
  SidebarSimpleIcon,
} from "@workspace/ui/components/icons"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import type { PanelImperativeHandle } from "react-resizable-panels"
import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

import { cn } from "@workspace/ui/lib/utils"

import { IconButton } from "@workspace/ui/components/icon-button"

import { TooltipProvider } from "@workspace/ui/components/tooltip"

import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  GroupMember,
} from "@/lib/types"
import { getGroupMembers } from "@/lib/canvas/layout"
import {
  MoveToPageContext,
  type MoveToPageTarget,
} from "@/components/canvas/move-to-page"
import {
  PAGE_DROP_PREFIX,
  PagesSection,
  pagesPanelHeight,
  type PagesSectionProps,
} from "@/components/panels/pages-section"

import { frameWorkspaceOf } from "@/components/canvas/frame-nav"

import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"

import { groupWorkspace } from "@/lib/canvas/group-workspace"
import { layerHolders } from "@/lib/canvas/layer-chat"
import { useChatSessions } from "@/lib/yjs/react"

import {
  parseSidebarRowId,
  resolveSidebarDrop,
  sidebarRowId,
  type MoveMemberTarget,
  type SidebarDropHint,
  type SidebarRow,
} from "@/lib/sidebar-drop"
import {
  IframeLayerRowMenu,
  IframeLayerRow,
  IframeLayerRowExtras,
} from "@/components/panels/layer-rows/iframe-layer-row"
import { renameOnF2 } from "@/components/panels/layer-rows/rename-key"
import { ROW_BUTTON_SELECTOR } from "@/components/panels/layer-rows/row-focus"
import { LayerMenu, groupLayerMenu } from "@/components/canvas/layer-menu"
import {
  frameGroupRowActionClass,
  frameGroupRowButtonClass,
} from "@/components/panels/layer-rows/row-action"

import {
  documentRow,
  mockupRow,
} from "@/components/panels/layer-rows/titled-layer-row"

import {
  useIsFrameHighlighted,
  useWorkspaceHoverProps,
} from "@/lib/workspace-hover-store"

/**
 * Resolved sidebar member — pairs the kind + id with the underlying data
 * looked up out of `iframeLayers` / `markdownLayers`. Members whose data is
 * missing (lookup races during deletion) are filtered out earlier.
 */
type ResolvedMember = { kind: string; id: string; data: unknown }

/** One visible row in the sidebar's Canvas section (see Sidebar Drop). */
type SidebarDragRow = SidebarRow<ResolvedMember>

/**
 * Which edge of `rect` a drop lands on — purely from the live POINTER Y vs the
 * row's vertical midpoint. Never the drag *direction* and never the dragged
 * item's center: a given pixel always resolves to the same edge, so the
 * indicator never depends on whether you approached from above or below
 * (no "drag up doesn't work until you wiggle back down").
 */
function pointerSide(rect: ClientRect, pointerY: number): "before" | "after" {
  return pointerY < rect.top + rect.height / 2 ? "before" : "after"
}

/**
 * The single drop indicator for the whole Canvas list, resolved once by the
 * parent on each drag move (by {@link resolveSidebarDrop}) and read by every
 * {@link SortableRow}. Exactly one row matches at a time, so a given gap is
 * ALWAYS painted at one pixel.
 */
type DropHint = SidebarDropHint

const DropHintContext = createContext<DropHint | null>(null)

function sameDropHint(a: DropHint | null, b: DropHint | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind || a.rowId !== b.rowId) return false
  return a.kind === "line" && b.kind === "line" ? a.edge === b.edge : true
}

/**
 * Fully pointer-driven collision for the Canvas list — the row (or gap) the
 * cursor is over, or, in the thin dead-spaces between rows, the one the cursor
 * is vertically closest to. It NEVER consults the dragged item's own rect, so
 * there is no center-distance hysteresis: the target depends only on where the
 * pointer IS, never on which direction you approached from. (This is the whole
 * fix for "drag up and you can't reach the top / drag down and you can't reach
 * the bottom unless you overshoot": that artifact comes from dragged-rect
 * collision, which this avoids.)
 *
 * When a whole GROUP is dragged, only the `gap:` strips are eligible. Groups
 * reorder strictly between other groups, and the gap strips already own those
 * positions — letting group/flat ROWS also light up would paint a second
 * indicator a couple pixels off the gap line, which reads as flicker as the
 * pointer crosses the row/gap boundary. Restricting to gaps makes the gap line
 * the single source of truth.
 */
const canvasCollision: CollisionDetection = (args) => {
  const draggingGroup =
    (args.active.data.current as { kind?: string } | undefined)?.kind ===
    "group-header"
  const eligible = (id: string | number) =>
    isPageDropId(id) || !draggingGroup || String(id).startsWith("gap:")

  const within = pointerWithin(args).filter((c) => eligible(c.id))
  if (within.length > 0) return within

  const y = args.pointerCoordinates?.y
  let best: { id: string | number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  if (y != null) {
    for (const container of args.droppableContainers) {
      // A page row takes a drop only with the pointer on it.
      if (!eligible(container.id) || isPageDropId(container.id)) continue
      const rect = args.droppableRects.get(container.id)
      if (!rect) continue
      const dist =
        y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      if (dist < bestDist) {
        bestDist = dist
        best = { id: container.id }
      }
    }
  }
  if (best) return [best]
  return closestCenter(args).filter(
    (c) => eligible(c.id) && !isPageDropId(c.id)
  )
}

const isPageDropId = (id: string | number) =>
  String(id).startsWith(PAGE_DROP_PREFIX)

/** What dropping a row on a page row moves (#1837): a Group's header moves
 *  the Group, a single-Layer Group's row its Group, a member row its Layer. */
function pageDropTarget(row: SidebarDragRow): MoveToPageTarget {
  if (row.kind === "member") return { kind: "layer", id: row.member.id }
  return { kind: "group", id: row.groupId }
}

/**
 * A row wired into dnd-kit's sortable context. We intentionally DON'T
 * apply `useSortable`'s `transform`/`transition` to the rendered div:
 * the strategy assumes a flat equal-height list, but this Canvas list
 * mixes group headers, indented members, and flat rows — letting the
 * strategy translate them mid-drag makes nested items fly around. The
 * dragged source goes opacity 0, the cursor preview is rendered by
 * `<DragOverlay>`, and the drop indicator is driven by a single parent-
 * computed {@link DropHint} (read from context) instead of per-row state.
 */
function SortableRow({
  id,
  groupId,
  className,
  children,
  ...rest
}: {
  id: string
  /** Group this row belongs to — tags the sortable so the parent's drop-hint
   *  computation can tell same-group reorders from cross-group nests. */
  groupId: string
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useSortable({
      id,
      data: { groupId, kind: parseSidebarRowId(id)?.kind },
    })
  // The parent computes ONE hint for the whole list (pointer-based, gap-
  // normalized) and we just render the part that targets this row. Exactly one
  // row ever matches, so the line can't flicker between adjacent rows.
  const hint = useContext(DropHintContext)
  const indicator: "before" | "after" | "into" | null =
    hint && hint.rowId === id
      ? hint.kind === "into"
        ? "into"
        : hint.edge
      : null
  // A row is one Tab stop: its select button (H9). That button is also the
  // keyboard drag handle, so Space on it picks the row up while Enter still
  // selects; the row div keeps the pointer listeners and isn't a stop itself.
  const rowRef = useRef<HTMLDivElement | null>(null)
  const roleDescription = attributes["aria-roledescription"]
  const describedBy = attributes["aria-describedby"]
  useLayoutEffect(() => {
    const handle =
      rowRef.current?.querySelector<HTMLElement>(ROW_BUTTON_SELECTOR) ?? null
    setActivatorNodeRef(handle)
    if (!handle) return
    handle.setAttribute("aria-roledescription", roleDescription)
    handle.setAttribute("aria-describedby", describedBy)
  })
  return (
    <div
      ref={(node) => {
        rowRef.current = node
        setNodeRef(node)
      }}
      data-sidebar-row={id.startsWith("group:") ? "group" : "row"}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn(
        "relative",
        // `ring` (not `ring-inset`) so it sits OUTSIDE the row, where it
        // remains visible even when the underlying row has its own
        // selection styling (e.g. a selected frame's accent ring).
        indicator === "into" && "z-10 rounded-md ring-2 ring-canvas-selection",
        className
      )}
      {...listeners}
      {...rest}
    >
      {children}
      {indicator === "before" || indicator === "after" ? (
        // Canvas before/after lines only ever land between members of a group
        // (a 4px `gap-1` list), so center the line in that gap.
        <DropLine side={indicator} offsetPx={3} />
      ) : null}
    </div>
  )
}

/**
 * The single canonical drop indicator — a 2px line in the canvas selection
 * token (`--canvas-selection`) so the sidebar and canvas share one "active
 * target" visual language. No rounded corners, no shadows.
 *
 * `offsetPx` is how far past the row's edge the line sits — tuned to land in
 * the MIDDLE of the gap to the neighbouring row. The 2px line centers on the
 * gap mid-line when `offsetPx === gap/2 + 1` (e.g. a 4px `gap-1` member list
 * wants `offsetPx = 3`). Defaults to 1 (flush) for the Workspaces list.
 */
function DropLine({
  side,
  offsetPx = 1,
}: {
  side: "before" | "after"
  offsetPx?: number
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-canvas-selection"
      style={side === "before" ? { top: -offsetPx } : { bottom: -offsetPx }}
    />
  )
}

/**
 * Droppable slot between (and around) the top-level groups. Stays a fixed
 * thin height regardless of drag state so dropping it in doesn't shove
 * the rest of the list around — the cursor itself drives `isOver`, which
 * lights the strip up as a visible "create new group here" indicator.
 */
function GapDrop({ sidebarIndex }: { sidebarIndex: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${sidebarIndex}` })
  return (
    <div ref={setNodeRef} aria-hidden className="relative -my-px h-1">
      {isOver ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-canvas-selection" />
      ) : null}
    </div>
  )
}

/** A Group as the sidebar lists it: everything but where it sits. */
export type SidebarLayerGroup = Omit<IframeLayerGroupData, "x" | "y">

/** A frame as the sidebar lists it. */
export type SidebarFrame = Pick<
  IframeLayerData,
  "id" | "branchId" | "label" | "route"
>

/** A Document or Mockup as the sidebar lists it. */
export type SidebarTitledLayer = Pick<MarkdownLayerData, "id" | "title">

interface RoomSidebarProps {
  /** The canvas's Workspaces: group and frame rows name theirs. */
  branches: BranchData[]
  /** The layers by what their rows show, without their size or page state:
   *  resizing or scrolling one doesn't re-render the sidebar. */
  iframeLayers: SidebarFrame[]
  markdownLayers: SidebarTitledLayer[]
  mockupLayers: SidebarTitledLayer[]
  /** Already sorted by sidebarOrder. */
  /** The Groups, in sidebar order. The sidebar never places a Group, so it
   *  takes them without their position: moving one doesn't re-render it. */
  iframeLayerGroups: SidebarLayerGroup[]
  selectedIframeLayerIds: Set<string>
  selectedGroupIds: Set<string>
  /** Selected Markdown and Mockup Layers (they share one selection Set). */
  selectedDocumentLayerIds: Set<string>
  onSelectGroup: (groupId: string, shiftKey: boolean) => void
  onZoomToGroup: (groupId: string) => void
  onSelectIframeLayer: (iframeLayerId: string, shiftKey: boolean) => void
  onZoomToIframeLayer: (iframeLayerId: string) => void
  onRenameIframeLayer: (id: string, label: string) => void
  onRemoveIframeLayer: (id: string) => void
  onSelectDocument: (id: string, shiftKey: boolean) => void
  onZoomToDocument: (id: string) => void
  onRenameDocument: (id: string, title: string) => void
  onRemoveDocument: (id: string) => void
  onZoomToMockup: (id: string) => void
  onRenameMockup: (id: string, title: string) => void
  onRemoveMockup: (id: string) => void
  onReorderIframeLayerGroups: (orderedIds: string[]) => void
  /**
   * Move a single member across (or within) groups. `target` either points
   * into an existing group at a gap index (as the sidebar shows it), or asks
   * for a new single-member group to be created at a given sidebar slot.
   */
  onMoveMember: (member: GroupMember, target: MoveMemberTarget) => void
  onRenameIframeLayerGroup: (groupId: string, name: string) => void
  onRemoveIframeLayerGroup: (groupId: string) => void
  onCollapseSidebar?: () => void
  /** The canvas's Pages (#1835); the layer list shows the current one's. */
  pages: PagesSectionProps["pages"]
  currentPageId: string
  onSelectPage: PagesSectionProps["onSelectPage"]
  onAddPage: PagesSectionProps["onAddPage"]
  onRenamePage: PagesSectionProps["onRenamePage"]
  /** Pinned under the layers (the getting-started checklist, #780). */
  footer?: React.ReactNode
}

/** How many page rows the Pages panel grows to fit before it scrolls. */
const MAX_FITTED_PAGE_ROWS = 5

/**
 * The canvas's left sidebar: its pages, and the groups, frames and documents
 * on the current one, and nothing else. The Workspaces list lives in the chat panel's
 * Chats menu (#1152).
 */
function RoomSidebarImpl({
  branches,
  iframeLayers,
  markdownLayers,
  mockupLayers,
  iframeLayerGroups,
  selectedIframeLayerIds,
  selectedGroupIds,
  selectedDocumentLayerIds,
  onSelectGroup,
  onZoomToGroup,
  onSelectIframeLayer,
  onZoomToIframeLayer,
  onRenameIframeLayer,
  onRemoveIframeLayer,
  onSelectDocument,
  onZoomToDocument,
  onRenameDocument,
  onRemoveDocument,
  onZoomToMockup,
  onRenameMockup,
  onRemoveMockup,
  onReorderIframeLayerGroups,
  onMoveMember,
  onRenameIframeLayerGroup,
  onRemoveIframeLayerGroup,
  onCollapseSidebar,
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
  onRenamePage,
  footer,
}: RoomSidebarProps) {
  // The Pages panel fits its rows (up to five) until someone drags the
  // divider; from then on it keeps the height they gave it.
  const pagesPanelRef = useRef<PanelImperativeHandle>(null)
  const pagesSizedByHandRef = useRef(false)
  const fittedPageRows = Math.min(pages.length, MAX_FITTED_PAGE_ROWS)
  const [pagesDefaultSize] = useState(
    () => `${pagesPanelHeight(fittedPageRows)}px`
  )
  useLayoutEffect(() => {
    if (pagesSizedByHandRef.current) return
    pagesPanelRef.current?.resize(`${pagesPanelHeight(fittedPageRows)}px`)
  }, [fittedPageRows])

  const iframeLayersById = useMemo(() => {
    const m = new Map<string, RoomSidebarProps["iframeLayers"][number]>()
    for (const a of iframeLayers) m.set(a.id, a)
    return m
  }, [iframeLayers])
  const documentsById = useMemo(() => {
    const m = new Map<string, RoomSidebarProps["markdownLayers"][number]>()
    for (const d of markdownLayers) m.set(d.id, d)
    return m
  }, [markdownLayers])
  const mockupsById = useMemo(
    () => new Map(mockupLayers.map((d) => [d.id, d])),
    [mockupLayers]
  )
  const branchesById = useMemo(() => {
    const m = new Map<string, BranchData>()
    for (const a of branches) m.set(a.id, a)
    return m
  }, [branches])
  // The Documents and Mockups a chat is working on right now (#1726): their
  // rows end in the 9-dot.
  const chatSessions = useChatSessions()
  const workingLayerIds = useMemo(
    () => new Set(layerHolders(chatSessions).keys()),
    [chatSessions]
  )

  /**
   * Per-kind sidebar row + menu component lookup. Each entry binds a
   * registered `LayerKindDescriptor` to its row + menu components plus
   * the per-kind selection state and mutators. To wire up a new layer
   * kind, drop another entry here keyed by `kind` — the dispatch loop
   * below picks the right components automatically.
   */
  // The Workspace each Group's row names: the one all its frames show
  // (#1276). Its frame rows then leave it off; otherwise each names its own.
  const groupBranchById = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const g of iframeLayerGroups)
      m.set(g.id, groupWorkspace(g, iframeLayersById)?.branchId)
    return m
  }, [iframeLayerGroups, iframeLayersById])
  // Keyed by its ids so moving a Group, which rewrites every Group, leaves the
  // frame rows alone.
  const framesNamedByGroupKey = useMemo(() => {
    const ids: string[] = []
    for (const g of iframeLayerGroups)
      if (groupBranchById.get(g.id))
        for (const member of getGroupMembers(g)) ids.push(member.id)
    return ids.join("\n")
  }, [iframeLayerGroups, groupBranchById])
  const framesNamedByGroup = useMemo(
    () =>
      new Set(framesNamedByGroupKey ? framesNamedByGroupKey.split("\n") : []),
    [framesNamedByGroupKey]
  )
  const iframeLayerRowExtras = useMemo(
    () => ({ branchesById, framesNamedByGroup }),
    [branchesById, framesNamedByGroup]
  )
  type AnyRowDispatcher = {
    Row: React.ComponentType<
      import("./layer-rows/types").LayerRowProps<unknown>
    >
    Menu: React.ComponentType<
      import("./layer-rows/types").LayerRowMenuProps<unknown>
    >
    isSelected: (id: string) => boolean
    isWorking?: (id: string) => boolean
    onSelect: (id: string, shiftKey: boolean) => void
    onActivate?: (id: string) => void
    onRename: (id: string, name: string) => void
    onRemove: (id: string) => void
  }
  // Keys match `GroupMember.kind` so the dispatch loop below can look up
  // each member's row + menu without a per-kind branch.
  const rowDispatchByKind: Record<string, AnyRowDispatcher | undefined> = {
    "iframe-layer": {
      Row: IframeLayerRow as AnyRowDispatcher["Row"],
      Menu: IframeLayerRowMenu as AnyRowDispatcher["Menu"],
      isSelected: (id) => selectedIframeLayerIds.has(id),
      onSelect: onSelectIframeLayer,
      onActivate: onZoomToIframeLayer,
      onRename: onRenameIframeLayer,
      onRemove: onRemoveIframeLayer,
    },
    "markdown-layer": {
      Row: documentRow.Row as AnyRowDispatcher["Row"],
      Menu: documentRow.Menu as AnyRowDispatcher["Menu"],
      isSelected: (id) => selectedDocumentLayerIds.has(id),
      isWorking: (id) => workingLayerIds.has(id),
      onSelect: onSelectDocument,
      onActivate: onZoomToDocument,
      onRename: onRenameDocument,
      onRemove: onRemoveDocument,
    },
    "mockup-layer": {
      Row: mockupRow.Row as AnyRowDispatcher["Row"],
      Menu: mockupRow.Menu as AnyRowDispatcher["Menu"],
      isSelected: (id) => selectedDocumentLayerIds.has(id),
      isWorking: (id) => workingLayerIds.has(id),
      // Mockups share the Document selection Set (see `lib/canvas/selection`).
      onSelect: onSelectDocument,
      onActivate: onZoomToMockup,
      onRename: onRenameMockup,
      onRemove: onRemoveMockup,
    },
  }

  /** A Member with its record, or `undefined` when the record is missing. */
  const resolveMember = useCallback(
    (m: GroupMember): ResolvedMember | undefined => {
      const data =
        m.kind === "iframe-layer"
          ? iframeLayersById.get(m.id)
          : m.kind === "markdown-layer"
            ? documentsById.get(m.id)
            : mockupsById.get(m.id)
      return data ? { kind: m.kind, id: m.id, data } : undefined
    },
    [iframeLayersById, documentsById, mockupsById]
  )

  /**
   * Flatten the groups list into one row per visible sidebar line. The
   * `SortableContext` below consumes this in order; the same list also
   * drives `RowOverlay` lookups during drag.
   */
  const flattenedRows = useMemo<SidebarDragRow[]>(() => {
    const rows: SidebarDragRow[] = []
    for (const group of iframeLayerGroups) {
      const members = getGroupMembers(group)
        .map(resolveMember)
        .filter((m) => m !== undefined)
      if (members.length === 1) {
        rows.push({ kind: "flat", groupId: group.id, member: members[0]! })
      } else if (members.length > 1) {
        rows.push({ kind: "group-header", groupId: group.id })
        for (const m of members) {
          rows.push({ kind: "member", groupId: group.id, member: m })
        }
      }
    }
    return rows
  }, [iframeLayerGroups, resolveMember])

  const sortableIds = useMemo(
    () => flattenedRows.map(sidebarRowId),
    [flattenedRows]
  )

  const sensors = useSensors(
    // Activation distance lets clicks/double-clicks (no movement) through to
    // selection + zoom handlers, but any real drag past 6px starts moving.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks a row up; Enter on its button selects, as it always has.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    })
  )

  const [activeDragRow, setActiveDragRow] = useState<SidebarDragRow | null>(
    null
  )
  const moveToPage = useContext(MoveToPageContext)
  // The single drop indicator for the Canvas list, recomputed on each move.
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  // Live pointer Y. dnd-kit's move events don't carry the pointer, so we track
  // it ourselves while a drag is active and read it when deciding before/after.
  const pointerYRef = useRef(0)
  const handlePointerMove = useCallback((e: PointerEvent) => {
    pointerYRef.current = e.clientY
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const row = flattenedRows.find(
        (r) => sidebarRowId(r) === String(event.active.id)
      )
      setActiveDragRow(row ?? null)
      const ae = event.activatorEvent as { clientY?: number }
      if (typeof ae.clientY === "number") pointerYRef.current = ae.clientY
      window.addEventListener("pointermove", handlePointerMove)
    },
    [flattenedRows, handlePointerMove]
  )

  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMove)
    setActiveDragRow(null)
    setDropHint(null)
  }, [handlePointerMove])

  const handleDragCancel = useCallback(() => {
    endDrag()
  }, [endDrag])

  /** Groups in sidebar order with their full member lists, for Sidebar Drop. */
  const dropGroups = useMemo(
    () =>
      iframeLayerGroups.map((g) => ({ id: g.id, members: getGroupMembers(g) })),
    [iframeLayerGroups]
  )

  /**
   * The Sidebar Drop decision (hint + intent) for a pointer over `over`.
   * `before`/`after` comes purely from the pointer vs the over row's midpoint,
   * so the drag-move hint and the drop commit read the same rule.
   */
  const resolveDrop = useCallback(
    (activeId: string, over: { id: string | number; rect: ClientRect }) =>
      resolveSidebarDrop({
        rows: flattenedRows,
        groups: dropGroups,
        activeId,
        overId: String(over.id),
        side: pointerSide(over.rect, pointerYRef.current),
      }),
    [flattenedRows, dropGroups]
  )

  // onDragMove (not onDragOver): the latter only fires when the `over` row
  // CHANGES, so the before/after edge wouldn't flip as the pointer crosses a
  // row's own midpoint. onDragMove fires on every move; the equality guard
  // keeps it from re-rendering unless the resolved hint actually changes.
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event
      const next =
        over && !isPageDropId(over.id)
          ? resolveDrop(String(active.id), over).hint
          : null
      setDropHint((prev) => (sameDropHint(prev, next) ? prev : next))
    },
    [resolveDrop]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && isPageDropId(over.id)) {
        endDrag()
        if (activeDragRow)
          moveToPage?.move(
            pageDropTarget(activeDragRow),
            String(over.id).slice(PAGE_DROP_PREFIX.length)
          )
        return
      }
      const intent = over ? resolveDrop(String(active.id), over).intent : null
      endDrag()
      if (!intent) return
      if (intent.kind === "reorder-groups")
        onReorderIframeLayerGroups(intent.orderedIds)
      else onMoveMember(intent.member, intent.target)
    },
    [
      resolveDrop,
      onMoveMember,
      onReorderIframeLayerGroups,
      endDrag,
      activeDragRow,
      moveToPage,
    ]
  )

  return (
    <IframeLayerRowExtras.Provider value={iframeLayerRowExtras}>
      <TooltipProvider>
        {/* Children fade in over the loading skeleton's matching sidebar
          (#735); the panel background itself is already there. */}
        <SidebarProvider className="flex h-full flex-col bg-sidebar text-sidebar-foreground select-none [&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0">
          <div
            data-tauri-drag-region
            className="flex h-12 items-center justify-end px-4 pr-3"
          >
            <IconButton
              label="Hide sidebar"
              shortcut="⌘B"
              tooltipSide="right"
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
              onClick={onCollapseSidebar}
            >
              <SidebarSimpleIcon />
            </IconButton>
          </div>
          <DndContext
            // Stable id keeps dnd-kit's a11y `aria-describedby` deterministic
            // across SSR/hydration (see file-dnd.tsx for the full rationale).
            id="room-sidebar-canvases"
            sensors={sensors}
            collisionDetection={canvasCollision}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <ResizablePanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="pages"
                panelRef={pagesPanelRef}
                defaultSize={pagesDefaultSize}
                minSize={`${pagesPanelHeight(1)}px`}
                maxSize="70%"
                groupResizeBehavior="preserve-pixel-size"
              >
                <PagesSection
                  pages={pages}
                  currentPageId={currentPageId}
                  onSelectPage={onSelectPage}
                  onAddPage={onAddPage}
                  onRenamePage={onRenamePage}
                />
              </ResizablePanel>
              <ResizableHandle
                aria-label="Resize pages"
                className="bg-sidebar-border focus-visible:ring-0"
                onPointerDown={() => {
                  pagesSizedByHandRef.current = true
                }}
                onKeyDown={() => {
                  pagesSizedByHandRef.current = true
                }}
              />
              <ResizablePanel id="layers" minSize="80px">
                <SidebarGroup>
                  <SidebarGroupLabel>Layers</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <DropHintContext.Provider value={dropHint}>
                      <SortableContext
                        items={sortableIds}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="flex w-full min-w-0 flex-col gap-0">
                          {iframeLayerGroups.map((group, gIdx) => {
                            // Resolve the group's members again here so the JSX can
                            // branch on count. `flattenedRows` is the source of
                            // truth for sortable IDs and overlay lookups; this
                            // local resolution drives the JSX shape (flat vs
                            // header + children).
                            const groupMembers = getGroupMembers(group)
                              .map(resolveMember)
                              .filter((m) => m !== undefined)

                            /** Render `<Row />` + `<Menu />` for a single member by
                             *  looking up the kind in `rowDispatchByKind`. New layer
                             *  kinds plug in by adding an entry to that map up top.
                             *  Wrapped in a component so each member can own its own
                             *  `EditableText` ref — shared between Row (input) and
                             *  Menu (Rename click triggers `startEditing()`). */
                            const memberProps = (
                              member: ResolvedMember,
                              variant: "flat" | "sub"
                            ) =>
                              memberEntryProps(
                                member,
                                variant,
                                rowDispatchByKind[member.kind]
                              )

                            const isGroupDragging =
                              activeDragRow?.kind === "group-header" &&
                              activeDragRow.groupId === group.id
                            return (
                              <Fragment key={group.id}>
                                <GapDrop sidebarIndex={gIdx} />
                                {groupMembers.length === 1 ? (
                                  <SortableMember
                                    rowId={`flat:${group.id}`}
                                    groupId={group.id}
                                    className="group/menu-item group/frame-row cursor-grab active:cursor-grabbing"
                                    {...memberProps(groupMembers[0]!, "flat")}
                                  />
                                ) : groupMembers.length > 1 ? (
                                  <div
                                    data-slot="sidebar-menu-item"
                                    data-sidebar="menu-item"
                                    className="group/menu-item relative flex flex-col"
                                    style={
                                      isGroupDragging
                                        ? { opacity: 0 }
                                        : undefined
                                    }
                                  >
                                    <Collapsible
                                      defaultOpen
                                      className="group/frame-collapsible flex flex-col"
                                    >
                                      <WithEditableRef>
                                        {({ ref: groupNameRef }) => (
                                          <SortableRow
                                            id={`group:${group.id}`}
                                            groupId={group.id}
                                            className="group/frame-group-row cursor-grab active:cursor-grabbing"
                                          >
                                            <GroupRowButton
                                              branchId={groupBranchById.get(
                                                group.id
                                              )}
                                              className={cn(
                                                frameGroupRowButtonClass,
                                                "!transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible"
                                              )}
                                              isActive={selectedGroupIds.has(
                                                group.id
                                              )}
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                onSelectGroup(
                                                  group.id,
                                                  e.shiftKey
                                                )
                                              }}
                                              onDoubleClick={(e) => {
                                                e.stopPropagation()
                                                onZoomToGroup(group.id)
                                              }}
                                              onKeyDown={(e) =>
                                                renameOnF2(e, groupNameRef)
                                              }
                                            >
                                              <CollapsibleTrigger
                                                asChild
                                                onClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                                onDoubleClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                              >
                                                <span className="relative shrink-0">
                                                  <FolderIcon className="block text-sidebar-foreground/70 group-hover/frame-group-row:hidden group-data-[state=open]/frame-collapsible:hidden" />
                                                  <FolderOpenIcon className="hidden text-sidebar-foreground/70 group-hover/frame-group-row:!hidden group-data-[state=open]/frame-collapsible:block" />
                                                  <CaretRightIcon className="hidden cursor-pointer text-sidebar-foreground/70 transition-transform group-hover/frame-group-row:!block group-data-[state=open]/frame-collapsible:rotate-90" />
                                                </span>
                                              </CollapsibleTrigger>
                                              <EditableText
                                                ref={groupNameRef}
                                                as="span"
                                                value={group.name ?? ""}
                                                onCommit={(next) =>
                                                  onRenameIframeLayerGroup(
                                                    group.id,
                                                    next
                                                  )
                                                }
                                                placeholder="Group"
                                                tabIndex={-1}
                                                className="min-w-0 font-medium text-sidebar-foreground/70"
                                                viewClassName="truncate"
                                                editClassName={cn(
                                                  editableTextFieldClass,
                                                  "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
                                                )}
                                              />
                                              {(() => {
                                                const id = groupBranchById.get(
                                                  group.id
                                                )
                                                const branch = id
                                                  ? branchesById.get(id)
                                                  : undefined
                                                const workspace =
                                                  frameWorkspaceOf(branch)
                                                return workspace ? (
                                                  // Names win: the Workspace takes only the room the name leaves.
                                                  <span className="flex min-w-10 flex-1 basis-0 text-sm font-normal text-muted-foreground">
                                                    <CompactWorkspaceMention
                                                      workspace={workspace}
                                                      layout="row"
                                                    />
                                                  </span>
                                                ) : null
                                              })()}
                                            </GroupRowButton>
                                            <LayerMenu
                                              placement="row"
                                              layerId={group.id}
                                              actions={groupLayerMenu(
                                                group.id,
                                                () =>
                                                  onRemoveIframeLayerGroup(
                                                    group.id
                                                  )
                                              )}
                                              onRename={() =>
                                                groupNameRef.current?.startEditing()
                                              }
                                              className={
                                                frameGroupRowActionClass
                                              }
                                            />
                                          </SortableRow>
                                        )}
                                      </WithEditableRef>
                                      <CollapsibleContent>
                                        <div
                                          data-slot="sidebar-menu-sub"
                                          data-sidebar="menu-sub"
                                          className="mr-0 ml-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border py-0.5 pr-0 pl-1"
                                        >
                                          {groupMembers.map((m) => (
                                            <SortableMember
                                              key={`${m.kind}:${m.id}`}
                                              rowId={`member:${m.kind}:${m.id}`}
                                              groupId={group.id}
                                              sub
                                              className="group/menu-sub-item group/frame-row cursor-grab active:cursor-grabbing"
                                              {...memberProps(m, "sub")}
                                            />
                                          ))}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  </div>
                                ) : null}
                              </Fragment>
                            )
                          })}
                          <GapDrop sidebarIndex={iframeLayerGroups.length} />
                        </div>
                      </SortableContext>
                    </DropHintContext.Provider>
                    {iframeLayerGroups.length === 0 && (
                      <div className="py-8 text-center text-sm text-balance text-sidebar-foreground/50">
                        Nothing on the canvas yet
                      </div>
                    )}
                  </SidebarGroupContent>
                </SidebarGroup>
                <DragOverlay dropAnimation={null}>
                  {activeDragRow ? (
                    <div className="rounded-md bg-sidebar opacity-95 shadow-lg ring-1 ring-sidebar-border">
                      {activeDragRow.kind === "group-header" ? (
                        <SidebarMenuButton className="!pr-2">
                          <FolderIcon className="text-sidebar-foreground/70" />
                          <span className="truncate font-medium text-sidebar-foreground/70">
                            {iframeLayerGroups.find(
                              (g) => g.id === activeDragRow.groupId
                            )?.name ?? "Group"}
                          </span>
                        </SidebarMenuButton>
                      ) : (
                        (() => {
                          const entry = memberEntryProps(
                            activeDragRow.member,
                            activeDragRow.kind === "flat" ? "flat" : "sub",
                            rowDispatchByKind[activeDragRow.member.kind]
                          )
                          return entry ? <MemberEntry {...entry} /> : null
                        })()
                      )}
                    </div>
                  ) : null}
                </DragOverlay>
              </ResizablePanel>
            </ResizablePanelGroup>
          </DndContext>
          {footer && <div className="shrink-0 p-2">{footer}</div>}
        </SidebarProvider>
      </TooltipProvider>
    </IframeLayerRowExtras.Provider>
  )
}

/** Owns a single `EditableText` handle and hands it to its children via
 *  render prop, so a row's name input and the matching dropdown's
 *  "Rename" item can share one ref without lifting state up. The menu
 *  (`LayerMenu`) waits for its own close before starting the edit. */
function WithEditableRef({
  children,
}: {
  children: (api: {
    ref: React.RefObject<EditableTextHandle | null>
  }) => React.ReactNode
}) {
  const ref = useRef<EditableTextHandle | null>(null)
  return <>{children({ ref })}</>
}

type RowDispatch = {
  Row: React.ComponentType<import("./layer-rows/types").LayerRowProps<unknown>>
  Menu: React.ComponentType<
    import("./layer-rows/types").LayerRowMenuProps<unknown>
  >
  isSelected: (id: string) => boolean
  isWorking?: (id: string) => boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onActivate?: (id: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

type MemberEntryProps = {
  item: unknown
  variant: "flat" | "sub"
  selected: boolean
  working: boolean | undefined
} & Omit<RowDispatch, "isSelected" | "isWorking">

/** A member's row props, resolved: plain values a memoized row can compare,
 *  so selecting one row doesn't re-render the others. */
function memberEntryProps(
  member: ResolvedMember,
  variant: "flat" | "sub",
  dispatch: RowDispatch | undefined
): MemberEntryProps | null {
  if (!dispatch) return null
  return {
    item: member.data,
    variant,
    selected: dispatch.isSelected(member.id),
    working: dispatch.isWorking?.(member.id),
    Row: dispatch.Row,
    Menu: dispatch.Menu,
    onSelect: dispatch.onSelect,
    onActivate: dispatch.onActivate,
    onRename: dispatch.onRename,
    onRemove: dispatch.onRemove,
  }
}

/** One member's `<Row />` + `<Menu />` pair, owning the inline-rename ref
 *  shared between them. */
function MemberEntry(entry: MemberEntryProps) {
  const editableRef = useRef<EditableTextHandle | null>(null)
  const { Row, Menu } = entry
  return (
    <>
      <Row
        item={entry.item}
        variant={entry.variant}
        selected={entry.selected}
        working={entry.working}
        onSelect={entry.onSelect}
        onActivate={entry.onActivate}
        onRename={entry.onRename}
        editableRef={editableRef}
      />
      <Menu
        item={entry.item}
        isSub={entry.variant === "sub"}
        onRename={entry.onRename}
        onRemove={entry.onRemove}
        editableRef={editableRef}
      />
    </>
  )
}

/** A member's sortable row, memoized on its resolved props. */
const SortableMember = memo(function SortableMember({
  rowId,
  groupId,
  className,
  sub,
  ...entry
}: {
  rowId: string
  groupId: string
  className: string
  sub?: boolean
} & Partial<MemberEntryProps>) {
  const slot = sub
    ? { "data-slot": "sidebar-menu-sub-item", "data-sidebar": "menu-sub-item" }
    : {}
  return (
    <SortableRow id={rowId} groupId={groupId} className={className} {...slot}>
      {entry.Row ? <MemberEntry {...(entry as MemberEntryProps)} /> : null}
    </SortableRow>
  )
})

/** A Group row (#872). Hovering it lights up its Workspace's row, and
 *  hovering that Workspace lights this row up, like a frame row's (#793). */
function GroupRowButton({
  branchId,
  className,
  ...props
}: { branchId: string | undefined } & React.ComponentProps<
  typeof SidebarMenuButton
>) {
  const isHighlighted = useIsFrameHighlighted(branchId)
  const hoverProps = useWorkspaceHoverProps(branchId, "group")
  return (
    <SidebarMenuButton
      {...props}
      {...hoverProps}
      className={cn(
        className,
        isHighlighted && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    />
  )
}

/**
 * Memoized: the canvas re-renders on every pointer move of a drag, marquee or
 * draw, and passes the sidebar props that keep their identity until they
 * change, so the rows render only when what they show does.
 */
export const RoomSidebar = memo(RoomSidebarImpl)
