"use client"

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
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
import {
  EditableText,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { BranchBadge } from "@/components/branch-badge"
import { RepoPicker, type RepoPickerSelection } from "@/components/repo-picker"
import { useDiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"
import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  GroupMember,
  RepoData,
} from "@/lib/types"
import { getGroupMembers } from "@/lib/canvas/layout"
import { reorderedIds, sortForSidebar } from "@/lib/sidebar-order"
import {
  IframeLayerRowMenu,
  makeIframeLayerRow,
} from "@/components/panels/layer-rows/iframe-layer-row"
import {
  DocumentRow,
  DocumentRowMenu,
} from "@/components/panels/layer-rows/markdown-layer-row"
import { listRepoBranches, type GitHubBranch } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { listRepoConfigs } from "@/lib/repo-configs-actions"
import { IframeLayerSizeSelect } from "@/components/iframe-layer-size-select"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { DeleteBranchDialog } from "@/components/delete-branch-dialog"
import { DeleteRepoDialog } from "@/components/delete-repo-dialog"
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
    return {
      kind: "member",
      memberKind: rest.slice(0, colon),
      memberId: rest.slice(colon + 1),
    }
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
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    isOver,
    over,
    active,
  } = useSortable({ id, data: { groupId } })
  // Three indicator states:
  //   "into"   — dropping a member onto a container (group header / flat
  //              row / closed group): full ring around the row.
  //   before / after — dropping adjacent to a row: thin top/bottom line.
  let indicator: "before" | "after" | "into" | null = null
  if (isOver && over && active) {
    const activeParsed = parseSortableId(String(active.id))
    const thisParsed = parseSortableId(id)
    const activeGroupId = (
      active.data.current as { groupId?: string } | undefined
    )?.groupId
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
        className
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
        side === "before" ? "-top-px" : "-bottom-px"
      )}
    />
  )
}

/**
 * A whole-row sortable for the "Branches" section — repos at the
 * top level, Branches nested inside each repo. Same interaction as
 * the Canvas section's `SortableRow` (drag the whole row, source goes
 * transparent, the `<DragOverlay>` paints the floating preview, a static
 * `<DropLine>` marks the target) but with the simpler before/after-only
 * semantics this section needs — there is no "into" nesting here.
 *
 * Drops are only valid between rows of the *same kind*, and for branches only
 * within the *same repo* (`repoId`): the indicator stays dark unless the
 * dragged row is a compatible target, which is what visually enforces the
 * within-repo constraint.
 */
function BranchesSortableRow({
  id,
  kind,
  repoId,
  className,
  children,
  ...rest
}: {
  id: string
  kind: "repo" | "branch"
  /** Owning repo, for branch rows — used to confine branch drops to one repo. */
  repoId?: string
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    isOver,
    over,
    active,
  } = useSortable({ id, data: { kind, repoId } })
  let indicator: "before" | "after" | null = null
  if (isOver && over && active && String(active.id) !== id) {
    const activeData = active.data.current as
      | { kind?: string; repoId?: string }
      | undefined
    const compatible =
      activeData?.kind === kind &&
      (kind === "repo" || activeData?.repoId === repoId)
    if (compatible) {
      const activeInitialTop = active.rect.current.initial?.top ?? 0
      const overTop = over.rect.top
      indicator = activeInitialTop < overTop ? "after" : "before"
    }
  }
  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn("relative", className)}
      {...attributes}
      {...listeners}
      {...rest}
    >
      {children}
      {indicator ? <DropLine side={indicator} /> : null}
    </div>
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
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-fuchsia-500" />
      ) : null}
    </div>
  )
}

interface RoomSidebarProps {
  repos: RepoData[]
  branches: BranchData[]
  iframeLayers: Array<
    Pick<IframeLayerData, "id" | "branchId" | "label" | "route">
  >
  markdownLayers: Array<Pick<MarkdownLayerData, "id" | "title">>
  /** Already sorted by sidebarOrder. */
  iframeLayerGroups: IframeLayerGroupData[]
  selectedIframeLayerIds: Set<string>
  selectedGroupIds: Set<string>
  selectedDocumentLayerIds: Set<string>
  onSelectGroup: (groupId: string, shiftKey: boolean) => void
  onZoomToGroup: (groupId: string) => void
  onSelectBranch: (id: string, options?: { expandPanel?: boolean }) => void
  onCreateRepo: (pick: RepoPickerSelection) => void
  onUpdateRepo: (id: string, data: Partial<RepoData>) => void
  onRemoveRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => void | Promise<void>
  onCreateBranch: (repoId: string) => void
  onCreateBranchFromGitBranch: (repoId: string, branch: string) => void
  onCreateParallelBranches: (repoId: string, specs: ParallelAgentSpec[]) => void
  onDuplicateBranch: (repoId: string, branch: string) => void
  onForkBranch: (branchId: string) => void
  onRebaseOnDefault: (branchId: string) => void
  onRefreshBranch: (id: string) => void
  onRemoveBranch: (
    id: string,
    options: { deleteOnRemote: boolean }
  ) => void | Promise<void>
  onAddIframeLayer: (branchId: string) => void
  onPlayBranch: (branchId: string) => void
  onShowRoutes: (branchId: string) => void
  onUpdateBranch: (id: string, data: Partial<BranchData>) => void
  onRenameBranch: (branchId: string, newBranch: string) => void
  onSelectIframeLayer: (iframeLayerId: string, shiftKey: boolean) => void
  onZoomToIframeLayer: (iframeLayerId: string) => void
  onRenameIframeLayer: (id: string, label: string) => void
  onRemoveIframeLayer: (id: string) => void
  onSelectDocument: (id: string, shiftKey: boolean) => void
  onZoomToDocument: (id: string) => void
  onRenameDocument: (id: string, title: string) => void
  onRemoveDocument: (id: string) => void
  onReorderIframeLayerGroups: (orderedIds: string[]) => void
  /** Persist the room-shared order of the repo list. */
  onReorderRepos: (orderedIds: string[]) => void
  /** Persist the room-shared order of one repo's Branch list. */
  onReorderBranches: (repoId: string, orderedIds: string[]) => void
  /**
   * Move a single member across (or within) groups. `target` either points
   * into an existing group at a specific index, or asks for a new
   * single-member group to be created at a given sidebar slot.
   */
  onMoveMember: (
    member: GroupMember,
    target:
      | { kind: "into-group"; groupId: string; index: number }
      | { kind: "new-group"; sidebarIndex: number }
  ) => void
  onRenameIframeLayerGroup: (groupId: string, name: string) => void
  onRemoveIframeLayerGroup: (groupId: string) => void
  onCollapseSidebar?: () => void
  activeBranchIds?: Set<string>
  chatPanelBranchId?: string | null
  /** GitHub-polled PR state per branch. Lifted to the parent so the sidebar
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

export function RoomSidebar({
  repos,
  branches,
  iframeLayers,
  markdownLayers,
  iframeLayerGroups,
  selectedIframeLayerIds,
  selectedGroupIds,
  selectedDocumentLayerIds,
  onSelectGroup,
  onZoomToGroup,
  onSelectBranch,
  onCreateRepo,
  onUpdateRepo,
  onRemoveRepo,
  onCreateBranch,
  onCreateBranchFromGitBranch,
  onCreateParallelBranches,
  onDuplicateBranch,
  onForkBranch,
  onRebaseOnDefault,
  onRefreshBranch,
  onRemoveBranch,
  onPlayBranch,
  onShowRoutes,
  onUpdateBranch,
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
  onReorderRepos,
  onReorderBranches,
  onMoveMember,
  onRenameIframeLayerGroup,
  onRemoveIframeLayerGroup,
  onCollapseSidebar,
  activeBranchIds,
  chatPanelBranchId,
  branchPrs,
}: RoomSidebarProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [settingsRepoId, setSettingsRepoId] = useState<string | null>(null)
  const [branchPickerRepoId, setBranchPickerRepoId] = useState<string | null>(
    null
  )
  const [parallelRepoId, setParallelRepoId] = useState<string | null>(null)
  const [pendingDeleteBranchId, setPendingDeleteBranchId] = useState<
    string | null
  >(null)
  const [pendingDeleteRepoId, setPendingDeleteRepoId] = useState<string | null>(
    null
  )
  const [savedConfigs, setSavedConfigs] = useState<RepoConfig[]>([])
  // Per-repo cache of remote branch names, fetched lazily on first
  // render of a repo and refreshed whenever the repo list changes.
  // Used to block inline-renames that would collide with an existing branch.
  const [remoteBranchesByRepo, setRemoteBranchesByRepo] = useState<
    Map<string, Set<string>>
  >(new Map())
  const diffStats = useDiffStats(branches, repos)
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

  // Fetch each repo's remote branch list once (per repo add). This
  // powers the inline-rename collision check below; without it we'd silently
  // let the user rename onto an existing branch and the server-side `git
  // branch -m` would fail after the fact.
  useEffect(() => {
    let cancelled = false
    for (const ws of repos) {
      if (remoteBranchesByRepo.has(ws.id)) continue
      listRepoBranches(ws.repoOwner, ws.repoName).then((data) => {
        if (cancelled) return
        setRemoteBranchesByRepo((prev) => {
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
  }, [repos, remoteBranchesByRepo])

  /**
   * Per-kind sidebar row + menu component lookup. Each entry binds a
   * registered `LayerKindDescriptor` to its row + menu components plus
   * the per-kind selection state and mutators. To wire up a new layer
   * kind, drop another entry here keyed by `kind` — the dispatch loop
   * below picks the right components automatically.
   */
  const IframeLayerRow = useMemo(
    () => makeIframeLayerRow({ branchesById }),
    [branchesById]
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
    () => flattenedRows.map(rowSortableId),
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

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const row = flattenedRows.find(
        (r) => rowSortableId(r) === String(event.active.id)
      )
      setActiveDragRow(row ?? null)
    },
    [flattenedRows]
  )

  const handleDragCancel = useCallback(() => {
    setActiveDragRow(null)
  }, [])

  // --- "Branches" section drag (repos + their branches) ---

  /**
   * Repos in effective sidebar order: manual `sidebarOrder` wins, falling back
   * to alphabetical by repo full name for any repo never dragged. The branch
   * lists sort the same way per repo, by `createdAt`, at render time.
   */
  const sortedRepos = useMemo(
    () =>
      sortForSidebar(repos, (a, b) =>
        a.repoFullName.localeCompare(b.repoFullName)
      ),
    [repos]
  )

  const branchFallback = useCallback(
    (a: BranchData, b: BranchData) => a.createdAt - b.createdAt,
    []
  )
  const branchesByRepo = useCallback(
    (repoId: string) =>
      sortForSidebar(
        branches.filter((a) => a.repoId === repoId),
        branchFallback
      ),
    [branches, branchFallback]
  )

  const [activeBranchesDrag, setActiveBranchesDrag] = useState<
    | { kind: "repo"; repo: RepoData }
    | { kind: "branch"; branch: BranchData }
    | null
  >(null)

  const handleBranchesDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id)
      if (id.startsWith("repo:")) {
        const ws = repos.find((w) => w.id === id.slice(5))
        setActiveBranchesDrag(ws ? { kind: "repo", repo: ws } : null)
      } else if (id.startsWith("branch:")) {
        const ag = branches.find((a) => a.id === id.slice(7))
        setActiveBranchesDrag(ag ? { kind: "branch", branch: ag } : null)
      }
    },
    [repos, branches]
  )

  const handleBranchesDragCancel = useCallback(() => {
    setActiveBranchesDrag(null)
  }, [])

  const handleBranchesDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveBranchesDrag(null)
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      // Top-level repo reorder — first drag stamps explicit `sidebarOrder` on
      // every repo (the ops verb renumbers 0..n), so manual order takes over.
      if (activeId.startsWith("repo:") && overId.startsWith("repo:")) {
        const currentIds = sortedRepos.map((w) => w.id)
        const newOrder = reorderedIds(
          currentIds,
          activeId.slice(5),
          overId.slice(5)
        )
        if (newOrder.join(",") !== currentIds.join(","))
          onReorderRepos(newOrder)
        return
      }

      // Branch reorder — confined to a single repo. A drop whose source and
      // target repos differ (or a drop onto a repo row) is ignored, so a
      // branch can never be filed under a repo it doesn't belong to.
      if (activeId.startsWith("branch:") && overId.startsWith("branch:")) {
        const activeWs = (
          active.data.current as { repoId?: string } | undefined
        )?.repoId
        const overWs = (over.data.current as { repoId?: string } | undefined)
          ?.repoId
        if (!activeWs || activeWs !== overWs) return
        const currentIds = branchesByRepo(activeWs).map((a) => a.id)
        const newOrder = reorderedIds(
          currentIds,
          activeId.slice(7),
          overId.slice(7)
        )
        if (newOrder.join(",") !== currentIds.join(","))
          onReorderBranches(activeWs, newOrder)
      }
    },
    [sortedRepos, branchesByRepo, onReorderRepos, onReorderBranches]
  )

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
    [iframeLayerGroups, onReorderIframeLayerGroups]
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
            {
              kind: activeRow.member.kind,
              id: activeRow.member.id,
            } as GroupMember,
            { kind: "new-group", sidebarIndex: overInfo.sidebarIndex }
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
        if (
          overInfo.kind === "group-header" &&
          overInfo.groupId === activeRow.groupId
        )
          return
        const overGroupId =
          overInfo.kind === "group-header" || overInfo.kind === "flat"
            ? overInfo.groupId
            : // over is a member — find its group via flattened rows
              flattenedRows.find(
                (r) =>
                  r.kind === "member" &&
                  r.member.kind === overInfo.memberKind &&
                  r.member.id === overInfo.memberId
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
            (g) => g.id === overInfo.groupId
          )
          if (sidebarIdx < 0) return
          onMoveMember(draggedMember, {
            kind: "new-group",
            sidebarIndex: sidebarIdx,
          })
          return
        }
        // Cross-group → append into the target group.
        const targetGroup = iframeLayerGroups.find(
          (g) => g.id === overInfo.groupId
        )
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
          r.member.id === overInfo.memberId
      )?.groupId
      if (!overGroupId) return
      const targetGroup = iframeLayerGroups.find((g) => g.id === overGroupId)
      if (!targetGroup) return
      const targetMembers = getGroupMembers(targetGroup)
      const overMemberIdx = targetMembers.findIndex(
        (m) => m.kind === overInfo.memberKind && m.id === overInfo.memberId
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
      if (activeRow.kind === "member" && activeRow.groupId === overGroupId) {
        const currentIdx = targetMembers.findIndex(
          (m) => m.kind === draggedMember.kind && m.id === draggedMember.id
        )
        if (currentIdx >= 0 && currentIdx < targetIndex) targetIndex -= 1
      }

      onMoveMember(draggedMember, {
        kind: "into-group",
        groupId: overGroupId,
        index: targetIndex,
      })
    },
    [flattenedRows, iframeLayerGroups, onMoveMember, reorderGroupToGap]
  )

  useEffect(() => {
    if (!showPicker) return
    let cancelled = false
    listRepoConfigs().then((list) => {
      if (!cancelled) setSavedConfigs(list)
    })
    return () => {
      cancelled = true
    }
  }, [showPicker])

  // Auto-select branches when they finish creating. onSelectBranch is stored in
  // a ref so this effect only depends on `branches` — otherwise the caller's
  // unstable callback reference causes it to fire every render and loops.
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const onSelectBranchRef = useRef(onSelectBranch)
  useEffect(() => {
    onSelectBranchRef.current = onSelectBranch
  })
  useEffect(() => {
    const prev = prevStatusRef.current
    for (const branch of branches) {
      const was = prev.get(branch.id)
      if (
        (was === "creating" || was === "starting") &&
        branch.status === "running"
      ) {
        onSelectBranchRef.current(branch.id)
      }
    }
    prevStatusRef.current = new Map(branches.map((a) => [a.id, a.status]))
  }, [branches])

  return (
    <SidebarProvider className="flex h-full flex-col bg-sidebar text-sidebar-foreground select-none">
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleBranchesDragStart}
          onDragEnd={handleBranchesDragEnd}
          onDragCancel={handleBranchesDragCancel}
        >
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
                    onCreateRepo(pick)
                    setShowPicker(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <SidebarGroupContent>
              <SidebarMenu className="gap-3">
                <SortableContext
                  items={sortedRepos.map((w) => `repo:${w.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {sortedRepos.map((repo) => {
                    const repoBranches = branchesByRepo(repo.id)
                    return (
                      <Collapsible
                        key={repo.id}
                        asChild
                        defaultOpen
                        className="group/collapsible"
                      >
                        <SidebarMenuItem className="!group-hover/menu-item:[&>[data-sidebar=menu-action]]:opacity-100">
                          <BranchesSortableRow
                            id={`repo:${repo.id}`}
                            kind="repo"
                            className="group/workspace-row cursor-grab active:cursor-grabbing"
                            data-settings-open={
                              settingsRepoId === repo.id || undefined
                            }
                          >
                            <SidebarMenuButton
                              className="!pr-2 !transition-[width,height] group-focus-within/workspace-row:!pr-[6.5rem] group-hover/workspace-row:!pr-[6.5rem] group-data-[settings-open]/workspace-row:!pr-[6.5rem]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <CollapsibleTrigger
                                asChild
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="relative shrink-0">
                                  <Folder className="block text-sidebar-foreground/70 group-hover/workspace-row:hidden group-data-[state=open]/collapsible:hidden" />
                                  <FolderOpen className="hidden text-sidebar-foreground/70 group-hover/workspace-row:!hidden group-data-[state=open]/collapsible:block" />
                                  <ChevronRight className="hidden cursor-pointer text-sidebar-foreground/70 transition-transform group-hover/workspace-row:!block group-data-[state=open]/collapsible:rotate-90" />
                                </span>
                              </CollapsibleTrigger>
                              <span className="truncate font-medium text-sidebar-foreground/70">
                                {repo.repoFullName}
                                {repo.name ? (
                                  <span className="text-sidebar-foreground/50">
                                    {" "}
                                    · {repo.name}
                                  </span>
                                ) : null}
                              </span>
                            </SidebarMenuButton>

                            <Popover
                              open={settingsRepoId === repo.id}
                              onOpenChange={(open) =>
                                setSettingsRepoId(open ? repo.id : null)
                              }
                            >
                              <PopoverTrigger asChild>
                                <SidebarMenuAction
                                  className="right-[4.75rem] group-focus-within/workspace-row:opacity-100 group-hover/workspace-row:opacity-100 aria-expanded:opacity-100 md:opacity-0"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Settings"
                                >
                                  <Settings />
                                </SidebarMenuAction>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-72 p-3"
                                side="bottom"
                                align="start"
                              >
                                <RepoSettings
                                  repo={repo}
                                  onUpdate={onUpdateRepo}
                                  onRemove={() => {
                                    setSettingsRepoId(null)
                                    setPendingDeleteRepoId(repo.id)
                                  }}
                                  onClose={() => setSettingsRepoId(null)}
                                />
                              </PopoverContent>
                            </Popover>
                            <SidebarMenuAction
                              className="right-[3.25rem] group-focus-within/workspace-row:opacity-100 group-hover/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100 md:opacity-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                setParallelRepoId(repo.id)
                              }}
                              title="Spin up parallel branches"
                            >
                              <Rows3 />
                            </SidebarMenuAction>
                            <SidebarMenuAction
                              className="right-7 group-focus-within/workspace-row:opacity-100 group-hover/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100 md:opacity-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                setBranchPickerRepoId(repo.id)
                              }}
                              title="New branch from branch"
                            >
                              <GitBranch />
                            </SidebarMenuAction>
                            <Dialog
                              open={branchPickerRepoId === repo.id}
                              onOpenChange={(open) =>
                                setBranchPickerRepoId(open ? repo.id : null)
                              }
                            >
                              <DialogContent className="max-w-sm gap-0 p-0">
                                <DialogHeader className="px-4 pt-4 pb-2">
                                  <DialogTitle>Select a branch</DialogTitle>
                                </DialogHeader>
                                <BranchPicker
                                  owner={repo.repoOwner}
                                  repo={repo.repoName}
                                  onSelect={(branch) => {
                                    setBranchPickerRepoId(null)
                                    onCreateBranchFromGitBranch(repo.id, branch)
                                  }}
                                  onDuplicate={(branch) => {
                                    setBranchPickerRepoId(null)
                                    onDuplicateBranch(repo.id, branch)
                                  }}
                                />
                              </DialogContent>
                            </Dialog>
                            <SidebarMenuAction
                              className="group-focus-within/workspace-row:opacity-100 group-hover/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100 aria-expanded:opacity-100 md:opacity-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                onCreateBranch(repo.id)
                              }}
                              title="New branch"
                            >
                              <Plus />
                            </SidebarMenuAction>
                          </BranchesSortableRow>

                          <CollapsibleContent>
                            <SidebarMenuSub>
                              <SortableContext
                                items={repoBranches.map(
                                  (a) => `branch:${a.id}`
                                )}
                                strategy={verticalListSortingStrategy}
                              >
                                {repoBranches.map((branch) => {
                                  const isLoading =
                                    branch.status === "creating" ||
                                    branch.status === "starting"
                                  const isActive =
                                    activeBranchIds?.has(branch.id) ?? false
                                  const isPanelActive =
                                    chatPanelBranchId === branch.id
                                  const pr = branchPrs.get(branch.id)

                                  return (
                                    <BranchesSortableRow
                                      key={branch.id}
                                      id={`branch:${branch.id}`}
                                      kind="branch"
                                      repoId={repo.id}
                                      className="cursor-grab active:cursor-grabbing"
                                    >
                                      <Collapsible
                                        asChild
                                        defaultOpen
                                        className="group/collapsible-branch"
                                      >
                                        <SidebarMenuItem>
                                          <WithEditableRef>
                                            {({
                                              ref: branchRef,
                                              triggerEdit: triggerBranchRename,
                                              onCloseAutoFocus:
                                                onBranchMenuCloseAutoFocus,
                                            }) => (
                                              <>
                                                <div
                                                  className={`group/branch-row grid grid-cols-[1fr_auto] items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground${isPanelActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    onSelectBranch(branch.id, {
                                                      expandPanel: false,
                                                    })
                                                  }}
                                                  onDoubleClick={(e) => {
                                                    e.stopPropagation()
                                                    onSelectBranch(branch.id)
                                                  }}
                                                >
                                                  <SidebarMenuSubButton
                                                    asChild
                                                    className="!bg-transparent !pr-0 hover:!bg-transparent"
                                                    isActive={false}
                                                  >
                                                    <div
                                                      title={
                                                        isLoading
                                                          ? branch.statusMessage ||
                                                            "Starting…"
                                                          : undefined
                                                      }
                                                    >
                                                      {isLoading || isActive ? (
                                                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sidebar-foreground/70" />
                                                      ) : pr?.state ===
                                                        "merged" ? (
                                                        <GitMerge className="shrink-0 text-purple-600 dark:text-purple-400" />
                                                      ) : pr?.state ===
                                                        "open" ? (
                                                        <GitPullRequest className="shrink-0 text-green-700 dark:text-green-300" />
                                                      ) : pr?.state ===
                                                        "closed" ? (
                                                        <GitPullRequestClosed className="shrink-0 text-red-600 dark:text-red-400" />
                                                      ) : (
                                                        <GitBranch className="shrink-0 text-sidebar-foreground/70" />
                                                      )}
                                                      {branch.ref ? (
                                                        <BranchBadge
                                                          ref={branchRef}
                                                          branch={branch.ref}
                                                          colorKey={branch.id}
                                                          colorIndex={
                                                            branch.colorIndex
                                                          }
                                                          className="px-1.5 py-0 text-[11px]"
                                                          onRename={(next) => {
                                                            const sanitized =
                                                              sanitizeBranchName(
                                                                next
                                                              )
                                                            if (!sanitized)
                                                              return
                                                            if (
                                                              sanitized ===
                                                              branch.ref
                                                            )
                                                              return
                                                            const remote =
                                                              remoteBranchesByRepo.get(
                                                                repo.id
                                                              )
                                                            const localTaken =
                                                              repoBranches.some(
                                                                (a) =>
                                                                  a.id !==
                                                                    branch.id &&
                                                                  a.ref ===
                                                                    sanitized
                                                              )
                                                            if (
                                                              localTaken ||
                                                              remote?.has(
                                                                sanitized
                                                              )
                                                            )
                                                              return
                                                            onRenameBranch(
                                                              branch.id,
                                                              sanitized
                                                            )
                                                          }}
                                                        />
                                                      ) : (
                                                        <span className="truncate font-mono text-xs text-muted-foreground">
                                                          creating...
                                                        </span>
                                                      )}
                                                    </div>
                                                  </SidebarMenuSubButton>
                                                  <div className="group/slot flex shrink-0 items-center pr-1 pl-2">
                                                    {(() => {
                                                      const stats =
                                                        diffStats.get(branch.id)
                                                      const hasStats =
                                                        stats &&
                                                        (stats.additions > 0 ||
                                                          stats.deletions > 0)
                                                      return (
                                                        <>
                                                          {hasStats && (
                                                            <span className="flex items-center gap-1 px-1 font-mono text-[10px] md:group-focus-within/branch-row:hidden md:group-hover/branch-row:hidden md:group-has-data-[menu-visible]/slot:hidden">
                                                              <span className="text-green-700 dark:text-green-300">
                                                                +
                                                                {
                                                                  stats.additions
                                                                }
                                                              </span>
                                                              <span className="text-red-700 dark:text-red-300">
                                                                -
                                                                {
                                                                  stats.deletions
                                                                }
                                                              </span>
                                                            </span>
                                                          )}
                                                          <BranchDropdownSlot
                                                            menuContent={
                                                              <DropdownMenuContent
                                                                side="right"
                                                                align="start"
                                                                className="w-48"
                                                                onCloseAutoFocus={
                                                                  onBranchMenuCloseAutoFocus
                                                                }
                                                              >
                                                                <DropdownMenuItem
                                                                  disabled={
                                                                    !branch.previewDomain
                                                                  }
                                                                  onClick={() =>
                                                                    onPlayBranch(
                                                                      branch.id
                                                                    )
                                                                  }
                                                                >
                                                                  <Play />
                                                                  Open prototype
                                                                  player
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                  disabled={
                                                                    !branch.ref
                                                                  }
                                                                  onClick={
                                                                    triggerBranchRename
                                                                  }
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
                                                                      value={
                                                                        branch.colorIndex !==
                                                                        undefined
                                                                          ? String(
                                                                              branch.colorIndex
                                                                            )
                                                                          : ""
                                                                      }
                                                                      onValueChange={(
                                                                        v
                                                                      ) =>
                                                                        onUpdateBranch(
                                                                          branch.id,
                                                                          {
                                                                            colorIndex:
                                                                              Number(
                                                                                v
                                                                              ),
                                                                          }
                                                                        )
                                                                      }
                                                                    >
                                                                      {BRANCH_COLORS.map(
                                                                        (
                                                                          c,
                                                                          i
                                                                        ) => (
                                                                          <DropdownMenuRadioItem
                                                                            key={
                                                                              c.name
                                                                            }
                                                                            value={String(
                                                                              i
                                                                            )}
                                                                          >
                                                                            <span
                                                                              className={cn(
                                                                                "size-4 rounded-[3px]",
                                                                                c.swatch
                                                                              )}
                                                                            />
                                                                            <span className="capitalize">
                                                                              {
                                                                                c.name
                                                                              }
                                                                            </span>
                                                                          </DropdownMenuRadioItem>
                                                                        )
                                                                      )}
                                                                    </DropdownMenuRadioGroup>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem
                                                                      disabled={
                                                                        branch.colorIndex ===
                                                                        undefined
                                                                      }
                                                                      onClick={() =>
                                                                        onUpdateBranch(
                                                                          branch.id,
                                                                          {
                                                                            colorIndex:
                                                                              undefined,
                                                                          }
                                                                        )
                                                                      }
                                                                    >
                                                                      Reset to
                                                                      default
                                                                    </DropdownMenuItem>
                                                                  </DropdownMenuSubContent>
                                                                </DropdownMenuSub>
                                                                <DropdownMenuItem
                                                                  onClick={() =>
                                                                    onForkBranch(
                                                                      branch.id
                                                                    )
                                                                  }
                                                                >
                                                                  <GitBranchPlus />
                                                                  Duplicate
                                                                  branch
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                  onClick={() =>
                                                                    onRefreshBranch(
                                                                      branch.id
                                                                    )
                                                                  }
                                                                >
                                                                  <RefreshCw />
                                                                  Restart
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                  disabled={
                                                                    !branch.discoveredRoutes ||
                                                                    branch
                                                                      .discoveredRoutes
                                                                      .length ===
                                                                      0
                                                                  }
                                                                  onClick={() =>
                                                                    onShowRoutes(
                                                                      branch.id
                                                                    )
                                                                  }
                                                                >
                                                                  <Route />
                                                                  Show all
                                                                  routes
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                  disabled={
                                                                    !branch.sandboxName ||
                                                                    !branch.ref
                                                                  }
                                                                  onClick={() =>
                                                                    onRebaseOnDefault(
                                                                      branch.id
                                                                    )
                                                                  }
                                                                >
                                                                  <GitMerge />
                                                                  Rebase on{" "}
                                                                  {
                                                                    repo.defaultBranch
                                                                  }
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem
                                                                  disabled={
                                                                    !branch.ref
                                                                  }
                                                                  onClick={() => {
                                                                    if (
                                                                      !branch.ref
                                                                    )
                                                                      return
                                                                    const url = `https://github.com/${repo.repoOwner}/${repo.repoName}/tree/${encodeURI(branch.ref)}`
                                                                    window.open(
                                                                      url,
                                                                      "_blank",
                                                                      "noopener,noreferrer"
                                                                    )
                                                                  }}
                                                                >
                                                                  <ExternalLink />
                                                                  Open branch on
                                                                  GitHub
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                  variant="destructive"
                                                                  onClick={() =>
                                                                    setPendingDeleteBranchId(
                                                                      branch.id
                                                                    )
                                                                  }
                                                                >
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

                                                {branch.error && (
                                                  <p className="px-2 pb-1 text-[10px] text-red-500">
                                                    {branch.error}
                                                  </p>
                                                )}
                                              </>
                                            )}
                                          </WithEditableRef>
                                        </SidebarMenuItem>
                                      </Collapsible>
                                    </BranchesSortableRow>
                                  )
                                })}
                              </SortableContext>
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    )
                  })}
                </SortableContext>
              </SidebarMenu>

              {repos.length === 0 && !showPicker && (
                <div className="py-8 text-center text-xs text-sidebar-foreground/50">
                  No workspaces yet
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
          <DragOverlay dropAnimation={null}>
            {activeBranchesDrag ? (
              <div className="rounded-md bg-sidebar opacity-95 shadow-lg ring-1 ring-sidebar-border">
                {activeBranchesDrag.kind === "repo" ? (
                  <SidebarMenuButton className="!pr-2">
                    <Folder className="text-sidebar-foreground/70" />
                    <span className="truncate font-medium text-sidebar-foreground/70">
                      {activeBranchesDrag.repo.repoFullName}
                    </span>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuSubButton asChild isActive={false}>
                    <div>
                      <GitBranch className="shrink-0 text-sidebar-foreground/70" />
                      {activeBranchesDrag.branch.ref ? (
                        <BranchBadge
                          branch={activeBranchesDrag.branch.ref}
                          colorKey={activeBranchesDrag.branch.id}
                          colorIndex={activeBranchesDrag.branch.colorIndex}
                          className="px-1.5 py-0 text-[11px]"
                        />
                      ) : (
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          creating...
                        </span>
                      )}
                    </div>
                  </SidebarMenuSubButton>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

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
                          groupMembers.push({ kind: m.kind, id: m.id, data: d })
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
                            style={isGroupDragging ? { opacity: 0 } : undefined}
                          >
                            <Collapsible
                              defaultOpen
                              className="group/frame-collapsible flex flex-col"
                            >
                              <WithEditableRef>
                                {({
                                  ref: groupNameRef,
                                  triggerEdit: triggerGroupRename,
                                  onCloseAutoFocus: onGroupMenuCloseAutoFocus,
                                }) => (
                                  <SortableRow
                                    id={`group:${group.id}`}
                                    groupId={group.id}
                                    className="group/frame-group-row cursor-grab active:cursor-grabbing"
                                  >
                                    <SidebarMenuButton
                                      className="!pr-2 !transition-[width,height] group-focus-within/frame-group-row:!pr-7 group-hover/frame-group-row:!pr-7 group-has-data-[state=open]/frame-group-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
                                      isActive={selectedGroupIds.has(group.id)}
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
                                          <Folder className="block text-sidebar-foreground/70 group-hover/frame-group-row:hidden group-data-[state=open]/frame-collapsible:hidden" />
                                          <FolderOpen className="hidden text-sidebar-foreground/70 group-hover/frame-group-row:!hidden group-data-[state=open]/frame-collapsible:block" />
                                          <ChevronRight className="hidden cursor-pointer text-sidebar-foreground/70 transition-transform group-hover/frame-group-row:!block group-data-[state=open]/frame-collapsible:rotate-90" />
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
                                        editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
                                      />
                                    </SidebarMenuButton>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <SidebarMenuAction className="group-focus-within/frame-group-row:opacity-100 group-hover/frame-group-row:opacity-100 aria-expanded:opacity-100 md:opacity-0">
                                          <MoreHorizontal />
                                        </SidebarMenuAction>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent
                                        side="right"
                                        align="start"
                                        className="w-48"
                                        onCloseAutoFocus={
                                          onGroupMenuCloseAutoFocus
                                        }
                                      >
                                        <DropdownMenuItem
                                          onClick={triggerGroupRename}
                                        >
                                          <Pencil />
                                          Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          variant="destructive"
                                          onClick={() =>
                                            onRemoveIframeLayerGroup(group.id)
                                          }
                                        >
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
              {iframeLayerGroups.length === 0 && (
                <div className="py-8 text-center text-xs text-sidebar-foreground/50">
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
                    <Folder className="text-sidebar-foreground/70" />
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
      {(() => {
        const branch = pendingDeleteBranchId
          ? branches.find((a) => a.id === pendingDeleteBranchId)
          : null
        return (
          <DeleteBranchDialog
            open={!!branch}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteBranchId(null)
            }}
            branchName={branch?.ref ?? ""}
            onConfirm={async ({ deleteOnRemote }) => {
              if (!branch) return
              await onRemoveBranch(branch.id, { deleteOnRemote })
              setPendingDeleteBranchId(null)
            }}
          />
        )
      })()}
      {(() => {
        const repo = parallelRepoId
          ? repos.find((w) => w.id === parallelRepoId)
          : null
        return repo ? (
          <ParallelCreateDialog
            open={true}
            onOpenChange={(open) => {
              if (!open) setParallelRepoId(null)
            }}
            repoOwner={repo.repoOwner}
            repoName={repo.repoName}
            defaultBranch={repo.defaultBranch}
            onSubmit={(specs) => onCreateParallelBranches(repo.id, specs)}
          />
        ) : null
      })()}
      {(() => {
        const repo = pendingDeleteRepoId
          ? repos.find((w) => w.id === pendingDeleteRepoId)
          : null
        const repoBranches = repo
          ? branches
              .filter((a) => a.repoId === repo.id && a.ref)
              .map((a) => a.ref)
          : []
        return (
          <DeleteRepoDialog
            open={!!repo}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteRepoId(null)
            }}
            repoName={repo?.name?.trim() || repo?.repoFullName || ""}
            branches={repoBranches}
            onConfirm={async ({ deleteBranchesOnRemote }) => {
              if (!repo) return
              await onRemoveRepo(repo.id, { deleteBranchesOnRemote })
              setPendingDeleteRepoId(null)
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

function BranchDropdownSlot({
  menuContent,
  children,
}: {
  menuContent: React.ReactNode
  children?: React.ReactNode
}) {
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
      className="flex items-center md:hidden md:group-focus-within/branch-row:flex md:group-hover/branch-row:flex md:data-[menu-visible]:flex"
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

function RepoSettings({
  repo,
  onUpdate,
  onRemove,
  onClose,
}: {
  repo: RepoData
  onUpdate: (id: string, data: Partial<RepoData>) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(repo.name ?? "")
  const [setupScript, setSetupScript] = useState(repo.setupScript)
  const [devScript, setDevScript] = useState(repo.devScript)
  const [devServerPort, setDevServerPort] = useState(
    String(repo.devServerPort ?? 3000)
  )
  const [envVars, setEnvVars] = useState(repo.envVars)
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    repo.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState(repo.systemPrompt ?? "")

  const parsedPort = Number.parseInt(devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const trimmedSystemPrompt = systemPrompt.trim()

  const handleSave = useCallback(() => {
    if (!portIsValid) return
    onUpdate(repo.id, {
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
    repo.id,
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
    name.trim() !== (repo.name ?? "") ||
    setupScript !== repo.setupScript ||
    devScript !== repo.devScript ||
    parsedPort !== (repo.devServerPort ?? 3000) ||
    envVars !== repo.envVars ||
    defaultIframeLayerSizeId !==
      (repo.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID) ||
    trimmedSystemPrompt !== (repo.systemPrompt ?? "")

  return (
    <div className="space-y-3">
      <span className="text-[10px] font-medium tracking-wide text-sidebar-foreground/70 uppercase">
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
          placeholder={repo.repoFullName}
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-[11px] placeholder:text-sidebar-foreground/50 focus:ring-1 focus:ring-sidebar-ring focus:outline-none"
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
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] placeholder:text-sidebar-foreground/50 focus:ring-1 focus:ring-sidebar-ring focus:outline-none"
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
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] placeholder:text-sidebar-foreground/50 focus:ring-1 focus:ring-sidebar-ring focus:outline-none"
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
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] placeholder:text-sidebar-foreground/50 focus:ring-1 focus:ring-sidebar-ring focus:outline-none"
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
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 font-mono text-[10px] placeholder:text-sidebar-foreground/50 focus:ring-1 focus:ring-sidebar-ring focus:outline-none"
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
          placeholder="Optional. Extra instructions for the branch (e.g. monorepo context)."
          className="w-full rounded-md border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-[11px] placeholder:text-sidebar-foreground/50 focus:ring-1 focus:ring-sidebar-ring focus:outline-none"
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
        onKeyDown={(e) => {
          metaRef.current = e.metaKey
        }}
        onKeyUp={() => {
          metaRef.current = false
        }}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading branches…
              </span>
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
              onSelect={() =>
                metaRef.current ? onDuplicate(b.name) : onSelect(b.name)
              }
            >
              <GitBranch className="text-sidebar-foreground/70" />
              <span className="flex-1 truncate">{b.name}</span>
              <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground group-data-selected/command-item:flex">
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
