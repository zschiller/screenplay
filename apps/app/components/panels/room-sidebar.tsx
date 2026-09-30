"use client"

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
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
  DotsThreeIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  SidebarSimpleIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
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

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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

import { frameWorkspaceOf } from "@/components/canvas/frame-nav"

import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"

import { groupBranchId } from "@/lib/canvas/group-workspace"

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
  makeIframeLayerRow,
} from "@/components/panels/layer-rows/iframe-layer-row"

import {
  DocumentRow,
  DocumentRowMenu,
} from "@/components/panels/layer-rows/markdown-layer-row"

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
    !draggingGroup || String(id).startsWith("gap:")

  const within = pointerWithin(args).filter((c) => eligible(c.id))
  if (within.length > 0) return within

  const y = args.pointerCoordinates?.y
  let best: { id: string | number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  if (y != null) {
    for (const container of args.droppableContainers) {
      if (!eligible(container.id)) continue
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
  return closestCenter(args).filter((c) => eligible(c.id))
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
  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        // Only keys pressed on the row itself start a keyboard drag, not ones
        // from a control inside it (a title, its … menu).
        setActivatorNodeRef(node)
      }}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn(
        "relative",
        // `ring` (not `ring-inset`) so it sits OUTSIDE the row, where it
        // remains visible even when the underlying row has its own
        // selection styling (e.g. a selected frame's accent ring).
        indicator === "into" && "z-10 rounded-md ring-2 ring-canvas-selection",
        className
      )}
      {...attributes}
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

interface RoomSidebarProps {
  /** The canvas's Workspaces: group and frame rows name theirs. */
  branches: BranchData[]
  iframeLayers: Array<
    Pick<IframeLayerData, "id" | "branchId" | "label" | "route">
  >
  markdownLayers: MarkdownLayerData[]
  /** Already sorted by sidebarOrder. */
  iframeLayerGroups: IframeLayerGroupData[]
  selectedIframeLayerIds: Set<string>
  selectedGroupIds: Set<string>
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
  /** Pinned under the layers (the getting-started checklist, #780). */
  footer?: React.ReactNode
}

/**
 * The canvas's left sidebar: its layers, the groups, frames and documents on
 * it, and nothing else. The Workspaces list lives in the chat panel's
 * Workspaces menu (#1152).
 */
export function RoomSidebar({
  branches,
  iframeLayers,
  markdownLayers,
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
  onReorderIframeLayerGroups,
  onMoveMember,
  onRenameIframeLayerGroup,
  onRemoveIframeLayerGroup,
  onCollapseSidebar,
  footer,
}: RoomSidebarProps) {
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
  const branchesById = useMemo(() => {
    const m = new Map<string, BranchData>()
    for (const a of branches) m.set(a.id, a)
    return m
  }, [branches])

  /**
   * Per-kind sidebar row + menu component lookup. Each entry binds a
   * registered `LayerKindDescriptor` to its row + menu components plus
   * the per-kind selection state and mutators. To wire up a new layer
   * kind, drop another entry here keyed by `kind` — the dispatch loop
   * below picks the right components automatically.
   */
  // Each Group's Workspace (#868): its row names it, and its frame rows name
  // theirs only when they differ.
  const groupBranchById = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const g of iframeLayerGroups)
      m.set(g.id, groupBranchId(g, iframeLayersById))
    return m
  }, [iframeLayerGroups, iframeLayersById])
  const groupBranchIdByLayerId = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const g of iframeLayerGroups)
      for (const member of getGroupMembers(g))
        m.set(member.id, groupBranchById.get(g.id))
    return m
  }, [iframeLayerGroups, groupBranchById])
  const IframeLayerRow = useMemo(
    () => makeIframeLayerRow({ branchesById, groupBranchIdByLayerId }),
    [branchesById, groupBranchIdByLayerId]
  )
  type AnyRowDispatcher = {
    Row: React.ComponentType<
      import("./layer-rows/types").LayerRowProps<unknown>
    >
    Menu: React.ComponentType<
      import("./layer-rows/types").LayerRowMenuProps<unknown>
    >
    isSelected: (id: string) => boolean
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
      Row: DocumentRow as AnyRowDispatcher["Row"],
      Menu: DocumentRowMenu as AnyRowDispatcher["Menu"],
      isSelected: (id) => selectedDocumentLayerIds.has(id),
      onSelect: onSelectDocument,
      onActivate: onZoomToDocument,
      onRename: onRenameDocument,
      onRemove: onRemoveDocument,
    },
  }

  /**
   * Flatten the groups list into one row per visible sidebar line. The
   * `SortableContext` below consumes this in order; the same list also
   * drives `RowOverlay` lookups during drag.
   */
  const flattenedRows = useMemo<SidebarDragRow[]>(() => {
    const rows: SidebarDragRow[] = []
    for (const group of iframeLayerGroups) {
      const members: ResolvedMember[] = []
      for (const m of getGroupMembers(group)) {
        if (m.kind === "iframe-layer") {
          const ab = iframeLayersById.get(m.id)
          if (ab) members.push({ kind: m.kind, id: m.id, data: ab })
          continue
        }
        if (m.kind === "markdown-layer") {
          const d = documentsById.get(m.id)
          if (d) members.push({ kind: m.kind, id: m.id, data: d })
        }
      }
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
  }, [iframeLayerGroups, iframeLayersById, documentsById])

  const sortableIds = useMemo(
    () => flattenedRows.map(sidebarRowId),
    [flattenedRows]
  )

  const sensors = useSensors(
    // Activation distance lets clicks/double-clicks (no movement) through to
    // selection + zoom handlers, but any real drag past 6px starts moving.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const [activeDragRow, setActiveDragRow] = useState<SidebarDragRow | null>(
    null
  )
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
      const next = over ? resolveDrop(String(active.id), over).hint : null
      setDropHint((prev) => (sameDropHint(prev, next) ? prev : next))
    },
    [resolveDrop]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      const intent = over ? resolveDrop(String(active.id), over).intent : null
      endDrag()
      if (!intent) return
      if (intent.kind === "reorder-groups")
        onReorderIframeLayerGroups(intent.orderedIds)
      else onMoveMember(intent.member, intent.target)
    },
    [resolveDrop, onMoveMember, onReorderIframeLayerGroups, endDrag]
  )

  return (
    <TooltipProvider>
      {/* Children fade in over the loading skeleton's matching sidebar
          (#735); the panel background itself is already there. */}
      <SidebarProvider className="flex h-full flex-col bg-sidebar text-sidebar-foreground select-none [&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0">
        <div
          data-tauri-drag-region
          className="flex h-12 items-center justify-end px-4 pr-3"
        >
          <IconButton
            label="Collapse sidebar"
            shortcut="⌘B"
            tooltipSide="right"
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent"
            onClick={onCollapseSidebar}
          >
            <SidebarSimpleIcon />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
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
            <SidebarGroup>
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
                        const groupMembers: ResolvedMember[] = []
                        for (const m of getGroupMembers(group)) {
                          if (m.kind === "iframe-layer") {
                            const ab = iframeLayersById.get(m.id)
                            if (ab)
                              groupMembers.push({
                                kind: m.kind,
                                id: m.id,
                                data: ab,
                              })
                            continue
                          }
                          if (m.kind === "markdown-layer") {
                            const d = documentsById.get(m.id)
                            if (d)
                              groupMembers.push({
                                kind: m.kind,
                                id: m.id,
                                data: d,
                              })
                          }
                        }

                        /** Render `<Row />` + `<Menu />` for a single member by
                         *  looking up the kind in `rowDispatchByKind`. New layer
                         *  kinds plug in by adding an entry to that map up top.
                         *  Wrapped in a component so each member can own its own
                         *  `EditableText` ref — shared between Row (input) and
                         *  Menu (Rename click triggers `startEditing()`). */
                        const renderMember = (
                          member: ResolvedMember,
                          variant: "flat" | "sub"
                        ) => (
                          <MemberEntry
                            member={member}
                            variant={variant}
                            dispatch={rowDispatchByKind[member.kind]}
                          />
                        )

                        const isGroupDragging =
                          activeDragRow?.kind === "group-header" &&
                          activeDragRow.groupId === group.id
                        return (
                          <Fragment key={group.id}>
                            <GapDrop sidebarIndex={gIdx} />
                            {groupMembers.length === 1 ? (
                              <SortableRow
                                id={`flat:${group.id}`}
                                groupId={group.id}
                                className="group/menu-item group/frame-row cursor-grab active:cursor-grabbing"
                              >
                                {renderMember(groupMembers[0]!, "flat")}
                              </SortableRow>
                            ) : groupMembers.length > 1 ? (
                              <div
                                data-slot="sidebar-menu-item"
                                data-sidebar="menu-item"
                                className="group/menu-item relative flex flex-col"
                                style={
                                  isGroupDragging ? { opacity: 0 } : undefined
                                }
                              >
                                <Collapsible
                                  defaultOpen
                                  className="group/frame-collapsible flex flex-col"
                                >
                                  <WithEditableRef>
                                    {({
                                      ref: groupNameRef,
                                      triggerEdit: triggerGroupRename,
                                      onCloseAutoFocus:
                                        onGroupMenuCloseAutoFocus,
                                    }) => (
                                      <SortableRow
                                        id={`group:${group.id}`}
                                        groupId={group.id}
                                        className="group/frame-group-row cursor-grab active:cursor-grabbing"
                                      >
                                        <GroupRowButton
                                          branchId={groupBranchById.get(
                                            group.id
                                          )}
                                          className="!pr-2 !transition-[width,height] group-focus-within/frame-group-row:!pr-7 group-hover/frame-group-row:!pr-7 group-has-[[data-sidebar=menu-action][data-state=open]]/frame-group-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
                                          isActive={selectedGroupIds.has(
                                            group.id
                                          )}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onSelectGroup(group.id, e.shiftKey)
                                          }}
                                          onDoubleClick={(e) => {
                                            e.stopPropagation()
                                            onZoomToGroup(group.id)
                                          }}
                                        >
                                          <CollapsibleTrigger
                                            asChild
                                            onClick={(e) => e.stopPropagation()}
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
                                              <span className="flex min-w-10 flex-1 basis-0 text-xs font-normal text-muted-foreground">
                                                <CompactWorkspaceMention
                                                  workspace={workspace}
                                                  layout="row"
                                                />
                                              </span>
                                            ) : null
                                          })()}
                                        </GroupRowButton>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <IconButton
                                              label="Group options"
                                              tooltipSide="right"
                                              asChild
                                            >
                                              <SidebarMenuAction className="group-focus-within/frame-group-row:opacity-100 group-hover/frame-group-row:opacity-100 aria-expanded:opacity-100 md:opacity-0">
                                                <DotsThreeIcon />
                                              </SidebarMenuAction>
                                            </IconButton>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent
                                            side="right"
                                            align="start"
                                            onCloseAutoFocus={
                                              onGroupMenuCloseAutoFocus
                                            }
                                          >
                                            <DropdownMenuItem
                                              onClick={triggerGroupRename}
                                            >
                                              <PencilSimpleIcon />
                                              Rename
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              variant="destructive"
                                              onClick={() =>
                                                onRemoveIframeLayerGroup(
                                                  group.id
                                                )
                                              }
                                            >
                                              <TrashIcon />
                                              Delete
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
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
                                        <SortableRow
                                          key={`${m.kind}:${m.id}`}
                                          id={`member:${m.kind}:${m.id}`}
                                          groupId={group.id}
                                          data-slot="sidebar-menu-sub-item"
                                          data-sidebar="menu-sub-item"
                                          className="group/menu-sub-item group/frame-row cursor-grab active:cursor-grabbing"
                                        >
                                          {renderMember(m, "sub")}
                                        </SortableRow>
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
                  <div className="py-8 text-center text-xs text-balance text-sidebar-foreground/50">
                    No frames yet
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
                    <MemberEntry
                      member={activeDragRow.member}
                      variant={activeDragRow.kind === "flat" ? "flat" : "sub"}
                      dispatch={rowDispatchByKind[activeDragRow.member.kind]}
                    />
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
        {footer && <div className="shrink-0 p-2">{footer}</div>}
      </SidebarProvider>
    </TooltipProvider>
  )
}

/** Owns a single `EditableText` handle and hands it to its children via
 *  render prop, so a row's name input and the matching dropdown's
 *  "Rename" item can share one ref without lifting state up.
 *
 *  Triggering rename from a dropdown is a two-step dance: the click sets
 *  a pending flag, the dropdown's `onCloseAutoFocus` fires once the menu
 *  has fully unmounted (and its focus trap with it), and only then do we
 *  call `startEditing` + `preventDefault` so focus lands on the inline
 *  input instead of the menu trigger. */
function WithEditableRef({
  children,
}: {
  children: (api: {
    ref: React.RefObject<EditableTextHandle | null>
    triggerEdit: () => void
    onCloseAutoFocus: (e: Event) => void
  }) => React.ReactNode
}) {
  const ref = useRef<EditableTextHandle | null>(null)
  const pendingEditRef = useRef(false)
  const triggerEdit = useCallback(() => {
    pendingEditRef.current = true
  }, [])
  const onCloseAutoFocus = useCallback((e: Event) => {
    if (!pendingEditRef.current) return
    pendingEditRef.current = false
    e.preventDefault()
    ref.current?.startEditing()
  }, [])
  return <>{children({ ref, triggerEdit, onCloseAutoFocus })}</>
}

/** Renders one layer-row's `<Row />` + `<Menu />` pair, owning the
 *  inline-rename ref shared between them. Extracted from the group
 *  dispatcher so each member gets its own hook scope. */
function MemberEntry({
  member,
  variant,
  dispatch,
}: {
  member: { kind: string; id: string; data: unknown }
  variant: "flat" | "sub"
  dispatch:
    | {
        Row: React.ComponentType<
          import("./layer-rows/types").LayerRowProps<unknown>
        >
        Menu: React.ComponentType<
          import("./layer-rows/types").LayerRowMenuProps<unknown>
        >
        isSelected: (id: string) => boolean
        onSelect: (id: string, shiftKey: boolean) => void
        onActivate?: (id: string) => void
        onRename: (id: string, name: string) => void
        onRemove: (id: string) => void
      }
    | undefined
}) {
  const editableRef = useRef<EditableTextHandle | null>(null)
  if (!dispatch) return null
  const { Row, Menu } = dispatch
  return (
    <>
      <Row
        item={member.data}
        variant={variant}
        selected={dispatch.isSelected(member.id)}
        onSelect={dispatch.onSelect}
        onActivate={dispatch.onActivate}
        onRename={dispatch.onRename}
        editableRef={editableRef}
      />
      <Menu
        item={member.data}
        isSub={variant === "sub"}
        onRename={dispatch.onRename}
        onRemove={dispatch.onRemove}
        editableRef={editableRef}
      />
    </>
  )
}

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
