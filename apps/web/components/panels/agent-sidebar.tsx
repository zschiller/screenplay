"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  FolderPlus,
  Plus,
  Folder,
  Loader2,
  Settings,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  RefreshCw,
  Rows3,
  FolderOpen,
  Trash2,
  MoreHorizontal,
  Pencil,
  Play,
  Route,
  PanelLeftClose,
  Terminal,
  Palette,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import { EditableText, type EditableTextHandle } from "@workspace/ui/components/editable-text"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { BRANCH_COLORS } from "@/lib/branch-colors"
import { cn } from "@workspace/ui/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Kbd } from "@workspace/ui/components/kbd"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { BranchBadge } from "@/components/branch-badge"
import { RepoPicker, type RepoPickerSelection } from "@/components/repo-picker"
import { useDiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"
import type {
  AgentData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  GroupMember,
  WorkspaceData,
} from "@/lib/types"
import { getGroupMembers } from "@/lib/iframe-layer-layout"
import {
  IframeLayerRowMenu,
  makeIframeLayerRow,
} from "@/components/panels/layer-rows/iframe-layer-row"
import {
  DocumentRow,
  DocumentRowMenu,
} from "@/components/panels/layer-rows/markdown-layer-row"
import { listRepoBranches, type GitHubBranch } from "@/lib/github-actions"
import { getSandboxCliContext } from "@/lib/sandbox-actions"
import type { WorkspaceConfig } from "@/lib/workspace-configs.types"
import { listWorkspaceConfigs } from "@/lib/workspace-configs-actions"
import { IframeLayerSizeSelect } from "@/components/iframe-layer-size-select"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { DeleteBranchDialog } from "@/components/delete-branch-dialog"
import { DeleteWorkspaceDialog } from "@/components/delete-workspace-dialog"
import {
  ParallelCreateDialog,
  type ParallelAgentSpec,
} from "@/components/parallel-create-dialog"

/**
 * Resolved sidebar member — pairs the kind + id with the underlying data
 * looked up out of `iframeLayers` / `markdownLayers`. Members whose data is
 * missing (lookup races during deletion) are filtered out earlier.
 */
type ResolvedMember = { kind: string; id: string; data: unknown }

/**
 * One visible row in the sidebar's Canvas section. `group-header` is the
 * folder line for a multi-member group, `flat` is the single-member
 * shorthand (no header), and `member` is a child row inside an expanded
 * multi-member group. The Sortable list contains one entry per row.
 */
type SidebarDragRow =
  | { kind: "group-header"; groupId: string }
  | { kind: "flat"; groupId: string; member: ResolvedMember }
  | { kind: "member"; groupId: string; member: ResolvedMember }

function rowSortableId(row: SidebarDragRow): string {
  if (row.kind === "group-header") return `group:${row.groupId}`
  if (row.kind === "flat") return `flat:${row.groupId}`
  return `member:${row.member.kind}:${row.member.id}`
}

type ParsedRowId =
  | { kind: "group-header"; groupId: string }
  | { kind: "flat"; groupId: string }
  | { kind: "member"; memberKind: string; memberId: string }
  | { kind: "gap"; sidebarIndex: number }

function parseSortableId(id: string): ParsedRowId | null {
  if (id.startsWith("gap:")) {
    return { kind: "gap", sidebarIndex: Number(id.slice(4)) }
  }
  if (id.startsWith("group:")) {
    return { kind: "group-header", groupId: id.slice(6) }
  }
  if (id.startsWith("flat:")) {
    return { kind: "flat", groupId: id.slice(5) }
  }
  if (id.startsWith("member:")) {
    const rest = id.slice(7)
    const colon = rest.indexOf(":")
    if (colon < 0) return null
    return { kind: "member", memberKind: rest.slice(0, colon), memberId: rest.slice(colon + 1) }
  }
  return null
}

/**
 * A row wired into dnd-kit's sortable context. We intentionally DON'T
 * apply `useSortable`'s `transform`/`transition` to the rendered div:
 * the strategy assumes a flat equal-height list, but this Canvas list
 * mixes group headers, indented members, and flat rows — letting the
 * strategy translate them mid-drag makes nested items fly around. The
 * dragged source goes opacity 0, the cursor preview is rendered by
 * `<DragOverlay>`, and `isOver` is exposed via `data-over` so callers
 * can render a static drop indicator instead.
 */
function SortableRow({
  id,
  groupId,
  className,
  children,
  ...rest
}: {
  id: string
  /** Group this row belongs to. Used to suppress the "into" indicator
   *  when the dragged member is already a child of this row's group. */
  groupId: string
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const { attributes, listeners, setNodeRef, isDragging, isOver, over, active } =
    useSortable({ id, data: { groupId } })
  // Three indicator states:
  //   "into"   — dropping a member onto a container (group header / flat
  //              row / closed group): full ring around the row.
  //   before / after — dropping adjacent to a row: thin top/bottom line.
  let indicator: "before" | "after" | "into" | null = null
  if (isOver && over && active) {
    const activeParsed = parseSortableId(String(active.id))
    const thisParsed = parseSortableId(id)
    const activeGroupId = (active.data.current as { groupId?: string } | undefined)
      ?.groupId
    if (activeParsed && thisParsed && activeParsed.kind !== "gap") {
      const activeIsMemberLike =
        activeParsed.kind === "member" || activeParsed.kind === "flat"
      const thisIsContainer =
        thisParsed.kind === "group-header" || thisParsed.kind === "flat"
      const sameGroup = activeGroupId !== undefined && activeGroupId === groupId
      if (activeIsMemberLike && thisIsContainer && !sameGroup) {
        indicator = "into"
      } else if (activeParsed.kind === "group-header" && sameGroup) {
        // Dragging a group header over one of its own children — no
        // sensible action; suppress the indicator entirely.
        indicator = null
      } else {
        const activeInitialTop = active.rect.current.initial?.top ?? 0
        const overTop = over.rect.top
        indicator = activeInitialTop < overTop ? "after" : "before"
      }
    }
  }
  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn(
        "relative",
        // `ring` (not `ring-inset`) so it sits OUTSIDE the row, where it
        // remains visible even when the underlying row has its own
        // selection styling (e.g. a selected frame's accent ring).
        indicator === "into" && "z-10 rounded-md ring-2 ring-fuchsia-500",
        className,
      )}
      {...attributes}
      {...listeners}
      {...rest}
    >
      {children}
      {indicator === "before" || indicator === "after" ? (
        <DropLine side={indicator} />
      ) : null}
    </div>
  )
}

/**
 * The single canonical drop indicator — a 2px fuchsia line flush with the
 * row's top or bottom edge. Matches the canvas selection color
 * (`#d946ef`, Tailwind `fuchsia-500`) so the sidebar and canvas share one
 * "active target" visual language. No rounded corners, no shadows.
 */
function DropLine({ side }: { side: "before" | "after" }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-fuchsia-500",
        side === "before" ? "-top-px" : "-bottom-px",
      )}
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
    <div ref={setNodeRef} aria-hidden className="relative h-1 -my-px">
      {isOver ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-fuchsia-500" />
      ) : null}
    </div>
  )
}

interface AgentSidebarProps {
  workspaces: WorkspaceData[]
  agents: AgentData[]
  iframeLayers: Array<Pick<IframeLayerData, "id" | "sandboxId" | "label" | "route">>
  markdownLayers: Array<Pick<MarkdownLayerData, "id" | "title">>
  /** Already sorted by sidebarOrder. */
  iframeLayerGroups: IframeLayerGroupData[]
  selectedIframeLayerIds: Set<string>
  selectedGroupIds: Set<string>
  selectedDocumentLayerIds: Set<string>
  onSelectGroup: (groupId: string, shiftKey: boolean) => void
  onZoomToGroup: (groupId: string) => void
  onSelectAgent: (id: string, options?: { expandPanel?: boolean }) => void
  onCreateWorkspace: (pick: RepoPickerSelection) => void
  onUpdateWorkspace: (id: string, data: Partial<WorkspaceData>) => void
  onRemoveWorkspace: (
    id: string,
    options: { deleteBranchesOnRemote: boolean },
  ) => void | Promise<void>
  onCreateAgent: (workspaceId: string) => void
  onCreateAgentFromBranch: (workspaceId: string, branch: string) => void
  onCreateParallelAgents: (workspaceId: string, specs: ParallelAgentSpec[]) => void
  onDuplicateBranch: (workspaceId: string, branch: string) => void
  onForkAgent: (agentId: string) => void
  onRebaseOnDefault: (agentId: string) => void
  onRefreshAgent: (id: string) => void
  onRemoveAgent: (
    id: string,
    options: { deleteOnRemote: boolean },
  ) => void | Promise<void>
  onAddIframeLayer: (agentId: string) => void
  onPlayAgent: (agentId: string) => void
  onShowRoutes: (agentId: string) => void
  onUpdateAgent: (id: string, data: Partial<AgentData>) => void
  onRenameBranch: (agentId: string, newBranch: string) => void
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
   * into an existing group at a specific index, or asks for a new
   * single-member group to be created at a given sidebar slot.
   */
  onMoveMember: (
    member: GroupMember,
    target:
      | { kind: "into-group"; groupId: string; index: number }
      | { kind: "new-group"; sidebarIndex: number },
  ) => void
  onRenameIframeLayerGroup: (groupId: string, name: string) => void
  onRemoveIframeLayerGroup: (groupId: string) => void
  onCollapseSidebar?: () => void
  activeAgentIds?: Set<string>
  chatPanelAgentId?: string | null
  /** GitHub-polled PR state per agent. Lifted to the parent so the sidebar
   *  and chat panel share one poller and can't disagree about whether a PR
   *  exists for a branch. */
  branchPrs: Map<string, BranchPrInfo>
}

function sanitizeBranchName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function AgentSidebar({
  workspaces,
  agents,
  iframeLayers,
  markdownLayers,
  iframeLayerGroups,
  selectedIframeLayerIds,
  selectedGroupIds,
  selectedDocumentLayerIds,
  onSelectGroup,
  onZoomToGroup,
  onSelectAgent,
  onCreateWorkspace,
  onUpdateWorkspace,
  onRemoveWorkspace,
  onCreateAgent,
  onCreateAgentFromBranch,
  onCreateParallelAgents,
  onDuplicateBranch,
  onForkAgent,
  onRebaseOnDefault,
  onRefreshAgent,
  onRemoveAgent,
  onAddIframeLayer,
  onPlayAgent,
  onShowRoutes,
  onUpdateAgent,
  onRenameBranch,
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
  activeAgentIds,
  chatPanelAgentId,
  branchPrs,
}: AgentSidebarProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null)
  const [branchPickerWorkspaceId, setBranchPickerWorkspaceId] = useState<string | null>(null)
  const [parallelWorkspaceId, setParallelWorkspaceId] = useState<string | null>(null)
  const [pendingDeleteAgentId, setPendingDeleteAgentId] = useState<string | null>(null)
  const [pendingDeleteWorkspaceId, setPendingDeleteWorkspaceId] = useState<string | null>(null)
  const [savedConfigs, setSavedConfigs] = useState<WorkspaceConfig[]>([])
  const [sandboxCliContext, setSandboxCliContext] = useState<{ scope?: string; project?: string }>({})
  // Per-workspace cache of remote branch names, fetched lazily on first
  // render of a workspace and refreshed whenever the workspace list changes.
  // Used to block inline-renames that would collide with an existing branch.
  const [remoteBranchesByWorkspace, setRemoteBranchesByWorkspace] = useState<Map<string, Set<string>>>(new Map())
  const diffStats = useDiffStats(agents, workspaces)
  const iframeLayersById = useMemo(() => {
    const m = new Map<string, AgentSidebarProps["iframeLayers"][number]>()
    for (const a of iframeLayers) m.set(a.id, a)
    return m
  }, [iframeLayers])
  const documentsById = useMemo(() => {
    const m = new Map<string, AgentSidebarProps["markdownLayers"][number]>()
    for (const d of markdownLayers) m.set(d.id, d)
    return m
  }, [markdownLayers])
  const agentsById = useMemo(() => {
    const m = new Map<string, AgentData>()
    for (const a of agents) m.set(a.id, a)
    return m
  }, [agents])

  // Fetch each workspace's remote branch list once (per workspace add). This
  // powers the inline-rename collision check below; without it we'd silently
  // let the user rename onto an existing branch and the server-side `git
  // branch -m` would fail after the fact.
  useEffect(() => {
    let cancelled = false
    for (const ws of workspaces) {
      if (remoteBranchesByWorkspace.has(ws.id)) continue
      listRepoBranches(ws.repoOwner, ws.repoName).then((data) => {
        if (cancelled) return
        setRemoteBranchesByWorkspace((prev) => {
          if (prev.has(ws.id)) return prev
          const next = new Map(prev)
          next.set(ws.id, new Set(data.map((b) => b.name)))
          return next
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [workspaces, remoteBranchesByWorkspace])

  /**
   * Per-kind sidebar row + menu component lookup. Each entry binds a
   * registered `LayerKindDescriptor` to its row + menu components plus
   * the per-kind selection state and mutators. To wire up a new layer
   * kind, drop another entry here keyed by `kind` — the dispatch loop
   * below picks the right components automatically.
   */
  const IframeLayerRow = useMemo(
    () => makeIframeLayerRow({ agentsById }),
    [agentsById],
  )
  type AnyRowDispatcher = {
    Row: React.ComponentType<import("./layer-rows/types").LayerRowProps<unknown>>
    Menu: React.ComponentType<import("./layer-rows/types").LayerRowMenuProps<unknown>>
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
    () => flattenedRows.map(rowSortableId),
    [flattenedRows],
  )

  const sensors = useSensors(
    // Activation distance lets clicks/double-clicks (no movement) through to
    // selection + zoom handlers, but any real drag past 6px starts moving.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [activeDragRow, setActiveDragRow] = useState<SidebarDragRow | null>(null)

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const row = flattenedRows.find((r) => rowSortableId(r) === String(event.active.id))
      setActiveDragRow(row ?? null)
    },
    [flattenedRows],
  )

  const handleDragCancel = useCallback(() => {
    setActiveDragRow(null)
  }, [])

  /**
   * Slot the source group into the sidebar at `sidebarIndex` (gap-space
   * coordinates: 0 = before first, N = after last). Accounts for the
   * removal of the source group itself so callers can pass the gap index
   * directly off a `gap:N` drop.
   */
  const reorderGroupToGap = useCallback(
    (groupId: string, sidebarIndex: number) => {
      const currentIds = iframeLayerGroups.map((g) => g.id)
      const currentIdx = currentIds.indexOf(groupId)
      if (currentIdx < 0) return
      let target = sidebarIndex
      if (currentIdx < sidebarIndex) target -= 1
      const withoutSource = currentIds.filter((_, i) => i !== currentIdx)
      const clamped = Math.max(0, Math.min(target, withoutSource.length))
      const newOrder = [
        ...withoutSource.slice(0, clamped),
        groupId,
        ...withoutSource.slice(clamped),
      ]
      if (newOrder.join(",") === currentIds.join(",")) return
      onReorderIframeLayerGroups(newOrder)
    },
    [iframeLayerGroups, onReorderIframeLayerGroups],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragRow(null)
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      const activeInfo = parseSortableId(activeId)
      if (!activeInfo || activeInfo.kind === "gap") return

      const activeRow = flattenedRows.find((r) => rowSortableId(r) === activeId)
      if (!activeRow) return

      const overInfo = parseSortableId(overId)
      if (!overInfo) return

      // Gap drop — either group reorder (preserving group id) or new
      // single-member group, depending on whether the dragged row IS a group.
      if (overInfo.kind === "gap") {
        if (activeRow.kind === "member") {
          onMoveMember(
            { kind: activeRow.member.kind, id: activeRow.member.id } as GroupMember,
            { kind: "new-group", sidebarIndex: overInfo.sidebarIndex },
          )
        } else {
          // group-header or flat → keep group identity
          reorderGroupToGap(activeRow.groupId, overInfo.sidebarIndex)
        }
        return
      }

      // Dragging a multi-member group's header onto another row → treat as
      // a whole-group reorder. (Nesting groups isn't a thing.)
      if (activeRow.kind === "group-header") {
        if (overInfo.kind === "group-header" && overInfo.groupId === activeRow.groupId)
          return
        const overGroupId =
          overInfo.kind === "group-header" || overInfo.kind === "flat"
            ? overInfo.groupId
            : // over is a member — find its group via flattened rows
              flattenedRows.find(
                (r) =>
                  r.kind === "member" &&
                  r.member.kind === overInfo.memberKind &&
                  r.member.id === overInfo.memberId,
              )?.groupId
        if (!overGroupId || overGroupId === activeRow.groupId) return
        const overIdx = iframeLayerGroups.findIndex((g) => g.id === overGroupId)
        if (overIdx < 0) return
        const insertAfter = event.delta.y > 0
        const sidebarIndex = insertAfter ? overIdx + 1 : overIdx
        reorderGroupToGap(activeRow.groupId, sidebarIndex)
        return
      }

      // Active is a member or a flat (= single-member) row — move that one
      // member to wherever the drop landed.
      const draggedMember: GroupMember = {
        kind: activeRow.member.kind,
        id: activeRow.member.id,
      } as GroupMember

      // Drop onto a multi-member group's header.
      if (overInfo.kind === "group-header") {
        if (overInfo.groupId === activeRow.groupId) {
          // Same group as the dragged member — the indicator paints a
          // "before" line above the header (the member started inside
          // the group, below the header, so direction is always "up"
          // from its perspective). Route that to "extract me into a new
          // sibling group above this one" — the same action the gap
          // above the group would trigger. Otherwise we'd silently no-op
          // and the user would have to creep 1–2 pixels further up to
          // hit the gap zone.
          const sidebarIdx = iframeLayerGroups.findIndex(
            (g) => g.id === overInfo.groupId,
          )
          if (sidebarIdx < 0) return
          onMoveMember(draggedMember, {
            kind: "new-group",
            sidebarIndex: sidebarIdx,
          })
          return
        }
        // Cross-group → append into the target group.
        const targetGroup = iframeLayerGroups.find((g) => g.id === overInfo.groupId)
        if (!targetGroup) return
        const targetMembers = getGroupMembers(targetGroup)
        onMoveMember(draggedMember, {
          kind: "into-group",
          groupId: overInfo.groupId,
          index: targetMembers.length,
        })
        return
      }

      // Drop onto another flat (single-member) row → merge into that group,
      // creating a 2-member group with a header.
      if (overInfo.kind === "flat") {
        if (overInfo.groupId === activeRow.groupId) return
        onMoveMember(draggedMember, {
          kind: "into-group",
          groupId: overInfo.groupId,
          index: 1,
        })
        return
      }

      // Drop adjacent to another member.
      const overGroupId = flattenedRows.find(
        (r) =>
          r.kind === "member" &&
          r.member.kind === overInfo.memberKind &&
          r.member.id === overInfo.memberId,
      )?.groupId
      if (!overGroupId) return
      const targetGroup = iframeLayerGroups.find((g) => g.id === overGroupId)
      if (!targetGroup) return
      const targetMembers = getGroupMembers(targetGroup)
      const overMemberIdx = targetMembers.findIndex(
        (m) => m.kind === overInfo.memberKind && m.id === overInfo.memberId,
      )
      if (overMemberIdx < 0) return

      // Direction = standard sortable semantics: if the dragged row
      // started above the over row in document order, dropping on it
      // means "after"; if it started below, "before". This matches the
      // drop indicator rendered by `SortableRow`, so the commit always
      // lands where the indicator pointed.
      const activeInitialTop = active.rect.current.initial?.top ?? 0
      const overTop = over.rect.top
      const insertAfter = activeInitialTop < overTop
      let targetIndex = insertAfter ? overMemberIdx + 1 : overMemberIdx

      // moveMember's same-group path expects an index in post-removal space.
      if (
        activeRow.kind === "member" &&
        activeRow.groupId === overGroupId
      ) {
        const currentIdx = targetMembers.findIndex(
          (m) => m.kind === draggedMember.kind && m.id === draggedMember.id,
        )
        if (currentIdx >= 0 && currentIdx < targetIndex) targetIndex -= 1
      }

      onMoveMember(draggedMember, {
        kind: "into-group",
        groupId: overGroupId,
        index: targetIndex,
      })
    },
    [
      flattenedRows,
      iframeLayerGroups,
      onMoveMember,
      reorderGroupToGap,
    ],
  )

  useEffect(() => {
    let cancelled = false
    getSandboxCliContext().then((ctx) => {
      if (!cancelled) setSandboxCliContext(ctx)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showPicker) return
    let cancelled = false
    listWorkspaceConfigs().then((list) => {
      if (!cancelled) setSavedConfigs(list)
    })
    return () => {
      cancelled = true
    }
  }, [showPicker])

  // Auto-select agents when they finish creating. onSelectAgent is stored in
  // a ref so this effect only depends on `agents` — otherwise the caller's
  // unstable callback reference causes it to fire every render and loops.
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const onSelectAgentRef = useRef(onSelectAgent)
  onSelectAgentRef.current = onSelectAgent
  useEffect(() => {
    const prev = prevStatusRef.current
    for (const agent of agents) {
      const was = prev.get(agent.id)
      if ((was === "creating" || was === "starting") && agent.status === "running") {
        onSelectAgentRef.current(agent.id)
      }
    }
    prevStatusRef.current = new Map(agents.map((a) => [a.id, a.status]))
  }, [agents])

  return (
    <SidebarProvider className="flex h-full flex-col select-none bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 items-center justify-end px-4 pr-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                onClick={onCollapseSidebar}
              >
                <PanelLeftClose />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Collapse sidebar <Kbd>⌘B</Kbd>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>Branches</SidebarGroupLabel>
          <Popover open={showPicker} onOpenChange={setShowPicker}>
            <PopoverTrigger asChild>
              <SidebarGroupAction title="Add workspace" className="top-1.5">
                <FolderPlus />
              </SidebarGroupAction>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" side="bottom" align="end">
              <RepoPicker
                configs={savedConfigs}
                onSelect={(pick) => {
                  onCreateWorkspace(pick)
                  setShowPicker(false)
                }}
              />
            </PopoverContent>
          </Popover>
          <SidebarGroupContent>
            <SidebarMenu className="gap-3">
              {workspaces
                .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName))
                .map((workspace) => {
                  const workspaceAgents = agents
                    .filter((a) => a.workspaceId === workspace.id)
                    .sort((a, b) => a.createdAt - b.createdAt)
                  return (
                    <Collapsible
                      key={workspace.id}
                      asChild
                      defaultOpen
                      className="group/collapsible"
                    >
                      <SidebarMenuItem className="!group-hover/menu-item:[&>[data-sidebar=menu-action]]:opacity-100">
                        <div
                          className="group/workspace-row relative"
                          data-settings-open={settingsWorkspaceId === workspace.id || undefined}
                        >
                          <SidebarMenuButton className="!pr-2 !transition-[width,height] group-hover/workspace-row:!pr-[6.5rem] group-focus-within/workspace-row:!pr-[6.5rem] group-data-[settings-open]/workspace-row:!pr-[6.5rem]" onClick={(e) => e.stopPropagation()}>
                            <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <span className="relative shrink-0">
                                <Folder className="block group-hover/workspace-row:hidden group-data-[state=open]/collapsible:hidden text-sidebar-foreground/70" />
                                <FolderOpen className="hidden group-data-[state=open]/collapsible:block group-hover/workspace-row:!hidden text-sidebar-foreground/70" />
                                <ChevronRight className="hidden group-hover/workspace-row:!block cursor-pointer text-sidebar-foreground/70 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                              </span>
                            </CollapsibleTrigger>
                            <span className="truncate font-medium text-sidebar-foreground/70">
                              {workspace.repoFullName}
                              {workspace.name ? (
                                <span className="text-sidebar-foreground/50"> · {workspace.name}</span>
                              ) : null}
                            </span>
                          </SidebarMenuButton>

                          <Popover
                            open={settingsWorkspaceId === workspace.id}
                            onOpenChange={(open) => setSettingsWorkspaceId(open ? workspace.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <SidebarMenuAction
                                className="right-[4.75rem] md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100 aria-expanded:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                                title="Settings"
                              >
                                <Settings />
                              </SidebarMenuAction>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-3" side="bottom" align="start">
                              <WorkspaceSettings
                                workspace={workspace}
                                onUpdate={onUpdateWorkspace}
                                onRemove={() => {
                                  setSettingsWorkspaceId(null)
                                  setPendingDeleteWorkspaceId(workspace.id)
                                }}
                                onClose={() => setSettingsWorkspaceId(null)}
                              />
                            </PopoverContent>
                          </Popover>
                          <SidebarMenuAction
                            className="right-[3.25rem] md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100"
                            onClick={(e) => { e.stopPropagation(); setParallelWorkspaceId(workspace.id) }}
                            title="Spin up parallel agents"
                          >
                            <Rows3 />
                          </SidebarMenuAction>
                          <SidebarMenuAction
                            className="right-7 md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100"
                            onClick={(e) => { e.stopPropagation(); setBranchPickerWorkspaceId(workspace.id) }}
                            title="New agent from branch"
                          >
                            <GitBranch />
                          </SidebarMenuAction>
                          <Dialog
                            open={branchPickerWorkspaceId === workspace.id}
                            onOpenChange={(open) => setBranchPickerWorkspaceId(open ? workspace.id : null)}
                          >
                            <DialogContent className="max-w-sm p-0 gap-0">
                              <DialogHeader className="px-4 pt-4 pb-2">
                                <DialogTitle>Select a branch</DialogTitle>
                              </DialogHeader>
                              <BranchPicker
                                owner={workspace.repoOwner}
                                repo={workspace.repoName}
                                onSelect={(branch) => {
                                  setBranchPickerWorkspaceId(null)
                                  onCreateAgentFromBranch(workspace.id, branch)
                                }}
                                onDuplicate={(branch) => {
                                  setBranchPickerWorkspaceId(null)
                                  onDuplicateBranch(workspace.id, branch)
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                          <SidebarMenuAction
                            className="md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100 aria-expanded:opacity-100"
                            onClick={(e) => { e.stopPropagation(); onCreateAgent(workspace.id) }}
                            title="New agent"
                          >
                            <Plus />
                          </SidebarMenuAction>
                        </div>

                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {workspaceAgents.map((agent) => {
                              const isLoading = agent.status === "creating" || agent.status === "starting"
                              const isActive = activeAgentIds?.has(agent.id) ?? false
                              const isPanelActive = chatPanelAgentId === agent.id
                              const pr = branchPrs.get(agent.id)

                              return (
                                <Collapsible
                                  key={agent.id}
                                  asChild
                                  defaultOpen
                                  className="group/collapsible-agent"
                                >
                                  <SidebarMenuItem>
                                    <WithEditableRef>
                                      {({ ref: branchRef, triggerEdit: triggerBranchRename, onCloseAutoFocus: onAgentMenuCloseAutoFocus }) => (
                                      <>
                                        <div
                                          className={`group/agent-row grid grid-cols-[1fr_auto] items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground${isPanelActive ? " bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
                                          onClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id, { expandPanel: false }) }}
                                          onDoubleClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id) }}
                                        >
                                          <SidebarMenuSubButton
                                            asChild
                                            className="!pr-0 !bg-transparent hover:!bg-transparent"
                                            isActive={false}
                                          >
                                            <div
                                              title={isLoading ? (agent.statusMessage || "Starting…") : undefined}
                                            >
                                              {isLoading || isActive ? (
                                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sidebar-foreground/70" />
                                              ) : pr?.state === "merged" ? (
                                                <GitMerge className="shrink-0 text-purple-600 dark:text-purple-400" />
                                              ) : pr?.state === "open" ? (
                                                <GitPullRequest className="shrink-0 text-green-700 dark:text-green-300" />
                                              ) : pr?.state === "closed" ? (
                                                <GitPullRequestClosed className="shrink-0 text-red-600 dark:text-red-400" />
                                              ) : (
                                                <GitBranch className="shrink-0 text-sidebar-foreground/70" />
                                              )}
                                              {agent.branch ? (
                                                <BranchBadge
                                                  ref={branchRef}
                                                  branch={agent.branch}
                                                  colorKey={agent.id}
                                                  colorIndex={agent.colorIndex}
                                                  className="text-[11px] py-0 px-1.5"
                                                  onRename={(next) => {
                                                    const sanitized = sanitizeBranchName(next)
                                                    if (!sanitized) return
                                                    if (sanitized === agent.branch) return
                                                    const remote = remoteBranchesByWorkspace.get(workspace.id)
                                                    const localTaken = workspaceAgents.some(
                                                      (a) => a.id !== agent.id && a.branch === sanitized,
                                                    )
                                                    if (localTaken || remote?.has(sanitized)) return
                                                    onRenameBranch(agent.id, sanitized)
                                                  }}
                                                />
                                              ) : (
                                                <span className="truncate font-mono text-xs text-muted-foreground">creating...</span>
                                              )}
                                            </div>
                                          </SidebarMenuSubButton>
                                          <div className="group/slot flex items-center shrink-0 pl-2 pr-1">
                                            {(() => {
                                              const stats = diffStats.get(agent.id)
                                              const hasStats = stats && (stats.additions > 0 || stats.deletions > 0)
                                              return (
                                                <>
                                                  {hasStats && (
                                                    <span className="flex items-center gap-1 px-1 font-mono text-[10px] md:group-hover/agent-row:hidden md:group-focus-within/agent-row:hidden md:group-has-data-[menu-visible]/slot:hidden">
                                                      <span className="text-green-700 dark:text-green-300">+{stats.additions}</span>
                                                      <span className="text-red-700 dark:text-red-300">-{stats.deletions}</span>
                                                    </span>
                                                  )}
                                                  <AgentDropdownSlot
                                                    menuContent={
                                                      <DropdownMenuContent side="right" align="start" className="w-48" onCloseAutoFocus={onAgentMenuCloseAutoFocus}>
                                                        <DropdownMenuItem
                                                          disabled={!agent.previewDomain}
                                                          onClick={() => onPlayAgent(agent.id)}
                                                        >
                                                          <Play />
                                                          Open prototype player
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                          disabled={!agent.branch}
                                                          onClick={triggerBranchRename}
                                                        >
                                                          <Pencil />
                                                          Rename
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSub>
                                                          <DropdownMenuSubTrigger>
                                                            <Palette />
                                                            Color
                                                          </DropdownMenuSubTrigger>
                                                          <DropdownMenuSubContent className="w-40">
                                                            <DropdownMenuRadioGroup
                                                              value={agent.colorIndex !== undefined ? String(agent.colorIndex) : ""}
                                                              onValueChange={(v) => onUpdateAgent(agent.id, { colorIndex: Number(v) })}
                                                            >
                                                              {BRANCH_COLORS.map((c, i) => (
                                                                <DropdownMenuRadioItem key={c.name} value={String(i)}>
                                                                  <span className={cn("size-4 rounded-[3px]", c.swatch)} />
                                                                  <span className="capitalize">{c.name}</span>
                                                                </DropdownMenuRadioItem>
                                                              ))}
                                                            </DropdownMenuRadioGroup>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                              disabled={agent.colorIndex === undefined}
                                                              onClick={() => onUpdateAgent(agent.id, { colorIndex: undefined })}
                                                            >
                                                              Reset to default
                                                            </DropdownMenuItem>
                                                          </DropdownMenuSubContent>
                                                        </DropdownMenuSub>
                                                        <DropdownMenuItem onClick={() => onForkAgent(agent.id)}>
                                                          <GitBranchPlus />
                                                          Duplicate branch
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => onRefreshAgent(agent.id)}>
                                                          <RefreshCw />
                                                          Restart
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                          disabled={!agent.discoveredRoutes || agent.discoveredRoutes.length === 0}
                                                          onClick={() => onShowRoutes(agent.id)}
                                                        >
                                                          <Route />
                                                          Show all routes
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                          disabled={!agent.sandboxName}
                                                          onClick={() => {
                                                            if (!agent.sandboxName) return
                                                            const parts = ["sandbox run"]
                                                            if (sandboxCliContext.scope) parts.push(`--scope ${sandboxCliContext.scope}`)
                                                            if (sandboxCliContext.project) parts.push(`--project ${sandboxCliContext.project}`)
                                                            parts.push(`--name ${agent.sandboxName}`)
                                                            parts.push("-i", "-t", "--", "claude")
                                                            navigator.clipboard.writeText(parts.join(" "))
                                                          }}
                                                        >
                                                          <Terminal />
                                                          Copy connection string
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                          disabled={!agent.sandboxName || !agent.branch}
                                                          onClick={() => onRebaseOnDefault(agent.id)}
                                                        >
                                                          <GitMerge />
                                                          Rebase on {workspace.defaultBranch}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                          disabled={!agent.branch}
                                                          onClick={() => {
                                                            if (!agent.branch) return
                                                            const url = `https://github.com/${workspace.repoOwner}/${workspace.repoName}/tree/${encodeURI(agent.branch)}`
                                                            window.open(url, "_blank", "noopener,noreferrer")
                                                          }}
                                                        >
                                                          <ExternalLink />
                                                          Open branch on GitHub
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem variant="destructive" onClick={() => setPendingDeleteAgentId(agent.id)}>
                                                          <Trash2 />
                                                          Delete
                                                        </DropdownMenuItem>
                                                      </DropdownMenuContent>
                                                    }
                                                  />
                                                </>
                                              )
                                            })()}
                                          </div>
                                        </div>

                                        {agent.error && (
                                          <p className="px-2 pb-1 text-[10px] text-red-500">{agent.error}</p>
                                        )}
                                      </>
                                      )}
                                    </WithEditableRef>
                                  </SidebarMenuItem>
                                </Collapsible>
                              )
                            })}

                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                })}
            </SidebarMenu>

            {workspaces.length === 0 && !showPicker && (
              <div className="py-8 text-center text-xs text-sidebar-foreground/50">
                No workspaces yet
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SidebarGroup>
            <SidebarGroupLabel>Canvas</SidebarGroupLabel>
            <SidebarGroupContent>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
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
                        if (ab) groupMembers.push({ kind: m.kind, id: m.id, data: ab })
                        continue
                      }
                      if (m.kind === "markdown-layer") {
                        const d = documentsById.get(m.id)
                        if (d) groupMembers.push({ kind: m.kind, id: m.id, data: d })
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
                      variant: "flat" | "sub",
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
                            style={isGroupDragging ? { opacity: 0 } : undefined}
                          >
                            <Collapsible defaultOpen className="group/frame-collapsible flex flex-col">
                              <WithEditableRef>
                                {({ ref: groupNameRef, triggerEdit: triggerGroupRename, onCloseAutoFocus: onGroupMenuCloseAutoFocus }) => (
                                  <SortableRow
                                    id={`group:${group.id}`}
                                    groupId={group.id}
                                    className="group/frame-group-row cursor-grab active:cursor-grabbing"
                                  >
                                    <SidebarMenuButton
                                      className="!pr-2 !transition-[width,height] group-hover/frame-group-row:!pr-7 group-focus-within/frame-group-row:!pr-7 group-has-data-[state=open]/frame-group-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
                                      isActive={selectedGroupIds.has(group.id)}
                                      onClick={(e) => { e.stopPropagation(); onSelectGroup(group.id, e.shiftKey) }}
                                      onDoubleClick={(e) => { e.stopPropagation(); onZoomToGroup(group.id) }}
                                    >
                                      <CollapsibleTrigger
                                        asChild
                                        onClick={(e) => e.stopPropagation()}
                                        onDoubleClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="relative shrink-0">
                                          <Folder className="block group-hover/frame-group-row:hidden group-data-[state=open]/frame-collapsible:hidden text-sidebar-foreground/70" />
                                          <FolderOpen className="hidden group-data-[state=open]/frame-collapsible:block group-hover/frame-group-row:!hidden text-sidebar-foreground/70" />
                                          <ChevronRight className="hidden group-hover/frame-group-row:!block cursor-pointer text-sidebar-foreground/70 transition-transform group-data-[state=open]/frame-collapsible:rotate-90" />
                                        </span>
                                      </CollapsibleTrigger>
                                      <EditableText
                                        ref={groupNameRef}
                                        as="span"
                                        value={group.name ?? ""}
                                        onCommit={(next) => onRenameIframeLayerGroup(group.id, next)}
                                        placeholder="Group"
                                        className="min-w-0 font-medium text-sidebar-foreground/70"
                                        viewClassName="truncate"
                                        editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
                                      />
                                    </SidebarMenuButton>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <SidebarMenuAction
                                          className="md:opacity-0 group-hover/frame-group-row:opacity-100 group-focus-within/frame-group-row:opacity-100 aria-expanded:opacity-100"
                                        >
                                          <MoreHorizontal />
                                        </SidebarMenuAction>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent side="right" align="start" className="w-48" onCloseAutoFocus={onGroupMenuCloseAutoFocus}>
                                        <DropdownMenuItem onClick={triggerGroupRename}>
                                          <Pencil />
                                          Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onClick={() => onRemoveIframeLayerGroup(group.id)}>
                                          <Trash2 />
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
                                  className="ml-3.5 mr-0 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border pl-1 pr-0 py-0.5"
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
              {iframeLayerGroups.length === 0 && (
                <div className="py-8 text-center text-xs text-sidebar-foreground/50">
                  No frames yet
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
          <DragOverlay dropAnimation={null}>
            {activeDragRow ? (
              <div className="rounded-md bg-sidebar shadow-lg ring-1 ring-sidebar-border opacity-95">
                {activeDragRow.kind === "group-header" ? (
                  <SidebarMenuButton className="!pr-2">
                    <Folder className="text-sidebar-foreground/70" />
                    <span className="truncate font-medium text-sidebar-foreground/70">
                      {iframeLayerGroups.find((g) => g.id === activeDragRow.groupId)?.name ?? "Group"}
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
      {(() => {
        const agent = pendingDeleteAgentId
          ? agents.find((a) => a.id === pendingDeleteAgentId)
          : null
        return (
          <DeleteBranchDialog
            open={!!agent}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteAgentId(null)
            }}
            branchName={agent?.branch ?? ""}
            onConfirm={async ({ deleteOnRemote }) => {
              if (!agent) return
              await onRemoveAgent(agent.id, { deleteOnRemote })
              setPendingDeleteAgentId(null)
            }}
          />
        )
      })()}
      {(() => {
        const workspace = parallelWorkspaceId
          ? workspaces.find((w) => w.id === parallelWorkspaceId)
          : null
        return workspace ? (
          <ParallelCreateDialog
            open={true}
            onOpenChange={(open) => {
              if (!open) setParallelWorkspaceId(null)
            }}
            repoOwner={workspace.repoOwner}
            repoName={workspace.repoName}
            defaultBranch={workspace.defaultBranch}
            onSubmit={(specs) => onCreateParallelAgents(workspace.id, specs)}
          />
        ) : null
      })()}
      {(() => {
        const workspace = pendingDeleteWorkspaceId
          ? workspaces.find((w) => w.id === pendingDeleteWorkspaceId)
          : null
        const workspaceBranches = workspace
          ? agents
              .filter((a) => a.workspaceId === workspace.id && a.branch)
              .map((a) => a.branch)
          : []
        return (
          <DeleteWorkspaceDialog
            open={!!workspace}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteWorkspaceId(null)
            }}
            workspaceName={workspace?.name?.trim() || workspace?.repoFullName || ""}
            branches={workspaceBranches}
            onConfirm={async ({ deleteBranchesOnRemote }) => {
              if (!workspace) return
              await onRemoveWorkspace(workspace.id, { deleteBranchesOnRemote })
              setPendingDeleteWorkspaceId(null)
            }}
          />
        )
      })()}
    </SidebarProvider>
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
        Row: React.ComponentType<import("./layer-rows/types").LayerRowProps<unknown>>
        Menu: React.ComponentType<import("./layer-rows/types").LayerRowMenuProps<unknown>>
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

function AgentDropdownSlot({ menuContent, children }: { menuContent: React.ReactNode; children?: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuClosing, setMenuClosing] = useState(false)
  const handleOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open)
    if (!open) {
      setMenuClosing(true)
      // Keep visible until Radix close animation finishes
      setTimeout(() => setMenuClosing(false), 150)
    }
  }, [])
  return (
    <span
      data-menu-visible={menuOpen || menuClosing || undefined}
      className="md:hidden md:group-hover/agent-row:flex md:group-focus-within/agent-row:flex md:data-[menu-visible]:flex flex items-center"
    >
      <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-5 w-5 items-center justify-center rounded-md text-sidebar-foreground/70 ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        {menuContent}
      </DropdownMenu>
      {children}
    </span>
  )
}

function WorkspaceSettings({
  workspace,
  onUpdate,
  onRemove,
  onClose,
}: {
  workspace: WorkspaceData
  onUpdate: (id: string, data: Partial<WorkspaceData>) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(workspace.name ?? "")
  const [setupScript, setSetupScript] = useState(workspace.setupScript)
  const [devScript, setDevScript] = useState(workspace.devScript)
  const [devServerPort, setDevServerPort] = useState(
    String(workspace.devServerPort ?? 3000),
  )
  const [envVars, setEnvVars] = useState(workspace.envVars)
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    workspace.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID,
  )
  const [systemPrompt, setSystemPrompt] = useState(workspace.systemPrompt ?? "")

  const parsedPort = Number.parseInt(devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const trimmedSystemPrompt = systemPrompt.trim()

  const handleSave = useCallback(() => {
    if (!portIsValid) return
    onUpdate(workspace.id, {
      name: name.trim(),
      setupScript,
      devScript,
      devServerPort: parsedPort,
      envVars,
      defaultIframeLayerSizeId,
      systemPrompt: trimmedSystemPrompt || undefined,
    })
    onClose()
  }, [
    workspace.id,
    name,
    setupScript,
    devScript,
    parsedPort,
    portIsValid,
    envVars,
    defaultIframeLayerSizeId,
    trimmedSystemPrompt,
    onUpdate,
    onClose,
  ])

  const hasChanges =
    name.trim() !== (workspace.name ?? "") ||
    setupScript !== workspace.setupScript ||
    devScript !== workspace.devScript ||
    parsedPort !== (workspace.devServerPort ?? 3000) ||
    envVars !== workspace.envVars ||
    defaultIframeLayerSizeId !==
      (workspace.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID) ||
    trimmedSystemPrompt !== (workspace.systemPrompt ?? "")

  return (
    <div className="space-y-3">
      <span className="text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wide">
        Settings
      </span>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={workspace.repoFullName}
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-[11px] placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          Setup script
        </label>
        <input
          type="text"
          value={setupScript}
          onChange={(e) => setSetupScript(e.target.value)}
          placeholder="npm install"
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          Dev script
        </label>
        <input
          type="text"
          value={devScript}
          onChange={(e) => setDevScript(e.target.value)}
          placeholder="npm run dev"
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          Dev server port
        </label>
        <input
          type="number"
          min={1}
          max={65535}
          value={devServerPort}
          onChange={(e) => setDevServerPort(e.target.value)}
          placeholder="3000"
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          Environment variables
        </label>
        <textarea
          value={envVars}
          onChange={(e) => setEnvVars(e.target.value)}
          placeholder={"KEY=value\nANOTHER_KEY=value"}
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[10px] placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
          rows={3}
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          Default iframeLayer size
        </label>
        <IframeLayerSizeSelect
          value={defaultIframeLayerSizeId}
          onChange={setDefaultIframeLayerSizeId}
          size="sm"
          className="text-[11px]"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-sidebar-foreground/70">
          System prompt
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Optional. Extra instructions for the agent (e.g. monorepo context)."
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-[11px] placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={handleSave}
          disabled={!hasChanges || !portIsValid}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-sidebar-foreground/70 hover:text-destructive"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

function BranchPicker({
  owner,
  repo,
  onSelect,
  onDuplicate,
}: {
  owner: string
  repo: string
  onSelect: (branch: string) => void
  onDuplicate: (branch: string) => void
}) {
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [loading, startTransition] = useTransition()
  const metaRef = useRef(false)

  useEffect(() => {
    startTransition(async () => {
      const data = await listRepoBranches(owner, repo)
      setBranches(data)
    })
  }, [owner, repo])

  return (
    <Command>
      <CommandInput
        placeholder="Search branches..."
        onKeyDown={(e) => { metaRef.current = e.metaKey }}
        onKeyUp={() => { metaRef.current = false }}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading branches…</span>
            </div>
          ) : (
            "No branches found."
          )}
        </CommandEmpty>
        <CommandGroup>
          {branches.map((b) => (
            <CommandItem
              key={b.name}
              value={b.name}
              onSelect={() => metaRef.current ? onDuplicate(b.name) : onSelect(b.name)}
            >
              <GitBranch className="text-sidebar-foreground/70" />
              <span className="truncate flex-1">{b.name}</span>
              <span className="hidden group-data-selected/command-item:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Kbd className="bg-popover">↵</Kbd>
                <span>Open</span>
                <Kbd className="ml-1.5 bg-popover">⌘↵</Kbd>
                <span>Duplicate</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

