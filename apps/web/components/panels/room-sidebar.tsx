"use client"

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
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
  FolderPlus,
  Folder,
  Loader2,
  Settings,
  ChevronRight,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Plus,
  FolderOpen,
  Trash2,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { BranchBadge } from "@/components/branch-badge"
import { GripSpinner } from "@/components/grip-spinner"
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
import { sortForSidebar } from "@/lib/sidebar-order"
import {
  IframeLayerRowMenu,
  makeIframeLayerRow,
} from "@/components/panels/layer-rows/iframe-layer-row"
import {
  DocumentRow,
  DocumentRowMenu,
} from "@/components/panels/layer-rows/markdown-layer-row"
import { listRepoBranches } from "@/lib/github-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { listRepoConfigs } from "@/lib/repo-configs-actions"
import { IframeLayerSizeSelect } from "@/components/iframe-layer-size-select"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { DeleteBranchDialog } from "@/components/delete-branch-dialog"
import { DeleteRepoDialog } from "@/components/delete-repo-dialog"
import { BranchPicker } from "@/components/branch-picker"
import { CreateBranchDialog } from "@/components/create-branch-dialog"
import type { ComposerSpec } from "@/lib/branch-create-planner"
import { BranchOverflowMenuContent } from "@/components/panels/branch-overflow-menu"

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
 * The single drop indicator for the whole Canvas list, computed once by the
 * parent on each drag move and read by every {@link SortableRow}. Exactly one
 * row matches at a time, so a given gap is ALWAYS painted at one pixel — the
 * line can't flicker between the bottom of one row and the top of the next.
 *   - `into`: nest the dragged member into this container row (full ring).
 *   - `line`: a thin rule on this row's `before`/`after` edge.
 */
type DropHint =
  | { kind: "into"; rowId: string }
  | { kind: "line"; rowId: string; edge: "before" | "after" }

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
 * The single before/after indicator for the Branches section (one for the repo
 * list, normalized per list so each gap is one pixel). No "into" — repos and
 * branches only reorder, never nest.
 */
type LineHint = { rowId: string; edge: "before" | "after" } | null

const BranchesDropHintContext = createContext<LineHint>(null)

function sameLineHint(a: LineHint, b: LineHint): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.rowId === b.rowId && a.edge === b.edge
}

/**
 * Drop strip between (and around) whole repos — the repo analogue of the
 * canvas {@link GapDrop}. Repos reorder by landing in these gaps, so the
 * before/after boundary sits between entire repos (header AND branches) and the
 * pointer flips at each repo's *full-extent* midpoint, not its header's.
 */
function RepoGap({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `repogap:${index}`,
    data: { kind: "repogap" },
  })
  return (
    <li ref={setNodeRef} aria-hidden className="relative -my-px h-1">
      {isOver ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-fuchsia-500" />
      ) : null}
    </li>
  )
}

/** True when droppable `data` is a legal target for the active Branches drag. */
/** Is droppable `target` a legal landing spot for the active Branches drag? */
function branchesEligible(
  active: { kind?: string; repoId?: string } | undefined,
  target: { kind?: string; repoId?: string } | undefined
): boolean {
  // A repo reorders by dropping into a `repogap` strip between whole repos
  // (just like a canvas group drops into a gap) — never onto a row.
  if (active?.kind === "repo") return target?.kind === "repogap"
  // A branch reorders only among sibling branches in its own repo.
  if (active?.kind === "branch")
    return target?.kind === "branch" && target.repoId === active.repoId
  return false
}

/**
 * Pointer-driven collision for the Branches list, mirroring {@link
 * canvasCollision} but with the section's constraints folded in: only droppables
 * the active drag is ALLOWED to land on are eligible (repo → gap strips; branch
 * → sibling branches in its own repo). A branch dragged over another repo yields
 * no target at all, rather than a misleading indicator.
 */
const branchesCollision: CollisionDetection = (args) => {
  const active = args.active.data.current as
    | { kind?: string; repoId?: string }
    | undefined
  const dataOf = (id: string | number) =>
    args.droppableContainers.find((c) => c.id === id)?.data.current as
      | { kind?: string; repoId?: string }
      | undefined

  const within = pointerWithin(args).filter((c) =>
    branchesEligible(active, dataOf(c.id))
  )
  if (within.length > 0) return within

  const y = args.pointerCoordinates?.y
  if (y == null) return []
  let best: { id: string | number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  let blockTop = Number.POSITIVE_INFINITY
  let blockBottom = Number.NEGATIVE_INFINITY
  for (const container of args.droppableContainers) {
    const data = container.data.current as
      | { kind?: string; repoId?: string }
      | undefined
    if (!branchesEligible(active, data)) continue
    const rect = args.droppableRects.get(container.id)
    if (!rect) continue
    blockTop = Math.min(blockTop, rect.top)
    blockBottom = Math.max(blockBottom, rect.bottom)
    const dist =
      y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    if (dist < bestDist) {
      bestDist = dist
      best = { id: container.id }
    }
  }
  if (!best) return []
  // Branch drags clamp to their repo's branch list span so a branch never
  // lights up a target while the pointer is off in another repo. Repo drags
  // snap to the nearest gap anywhere in the list.
  if (active?.kind === "branch" && (y < blockTop || y > blockBottom)) return []
  return [best]
}

/**
 * Move `activeId` to the `before`/`after` side of `overId` within `ids`. Unlike
 * arrayMove (which places by index and so depends on drag direction), this is
 * driven purely by the resolved side, so the commit lands exactly where the
 * indicator pointed.
 */
function reorderToSide(
  ids: readonly string[],
  activeId: string,
  overId: string,
  after: boolean
): string[] {
  const without = ids.filter((x) => x !== activeId)
  let idx = without.indexOf(overId)
  if (idx < 0) return [...ids]
  if (after) idx += 1
  without.splice(idx, 0, activeId)
  return without
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
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id,
    data: { groupId, kind: parseSortableId(id)?.kind },
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
        // Canvas before/after lines only ever land between members of a group
        // (a 4px `gap-1` list), so center the line in that gap.
        <DropLine side={indicator} offsetPx={3} />
      ) : null}
    </div>
  )
}

/**
 * The single canonical drop indicator — a 2px fuchsia line. Matches the canvas
 * selection color (`#d946ef`, Tailwind `fuchsia-500`) so the sidebar and canvas
 * share one "active target" visual language. No rounded corners, no shadows.
 *
 * `offsetPx` is how far past the row's edge the line sits — tuned to land in
 * the MIDDLE of the gap to the neighbouring row. The 2px line centers on the
 * gap mid-line when `offsetPx === gap/2 + 1` (e.g. a 4px `gap-1` member list
 * wants `offsetPx = 3`). Defaults to 1 (flush) for the tight Branches list.
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
      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-fuchsia-500"
      style={side === "before" ? { top: -offsetPx } : { bottom: -offsetPx }}
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
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id,
    data: { kind, repoId },
  })
  // Same model as the Canvas SortableRow: the parent resolves ONE pointer-based,
  // gap-normalized hint and we render only the part that targets this row.
  const hint = useContext(BranchesDropHintContext)
  // Only branch rows draw a line here. Repos reorder via the RepoGap strips
  // between whole repos, so a repo never produces a row-level hint.
  const indicator =
    kind === "branch" && hint && hint.rowId === id ? hint.edge : null
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
      {/* branch rows sit in a 4px `gap-1` list — center the line in the gap. */}
      {indicator ? <DropLine side={indicator} offsetPx={3} /> : null}
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
  // Full layer data (not just id/title): the New-Workspace dialog forwards it
  // to the seed Composer as the `@`-mention source, which types it as
  // `MarkdownLayerData[]`. Canvas already passes the full records.
  markdownLayers: MarkdownLayerData[]
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
  onCreateBranchFromGitBranch: (repoId: string, branch: string) => void
  /**
   * Prompt-first "New Workspace" create — resolves one spec per row via the
   * planner. A single row is the common case; parallel mode (#327) hands
   * several, each becoming its own Branch.
   */
  onCreateWorkspace: (repoId: string, specs: ComposerSpec[]) => void
  onRebaseOnDefault: (branchId: string) => void
  /** Bounce the dev server in place (no VM cycle) — the cheap preview recovery. */
  onRestartDevServer: (id: string) => void
  /** Opens a GitHub PR for the branch via the direct server action (#355). */
  onCreatePr: (branchId: string) => void
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
  onCreateBranchFromGitBranch,
  onCreateWorkspace,
  onRebaseOnDefault,
  onRestartDevServer,
  onCreatePr,
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
  const [newWorkspaceRepoId, setNewWorkspaceRepoId] = useState<string | null>(
    null
  )
  // The base the create dialog seeds on when opened from "New branch from
  // here…" (#353). Null for the plain "New Workspace" entry, which seeds on the
  // Repo default.
  const [newWorkspaceBaseBranch, setNewWorkspaceBaseBranch] = useState<
    string | null
  >(null)
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
        (r) => rowSortableId(r) === String(event.active.id)
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

  /** Group a parsed `over` row belongs to (members don't carry it in the id). */
  const overRowGroupId = useCallback(
    (over: ParsedRowId): string | undefined => {
      if (over.kind === "group-header" || over.kind === "flat")
        return over.groupId
      if (over.kind === "member")
        return flattenedRows.find(
          (r) =>
            r.kind === "member" &&
            r.member.kind === over.memberKind &&
            r.member.id === over.memberId
        )?.groupId
      return undefined
    },
    [flattenedRows]
  )

  /**
   * The one canonical hint for the current pointer position. `before`/`after`
   * comes purely from the pointer vs the over row's midpoint; an `after` on a
   * member is normalized to `before` of the next member in the SAME group so a
   * given gap always renders at one fixed pixel.
   */
  const computeDropHint = useCallback(
    (
      activeRow: SidebarDragRow,
      overId: string,
      overRect: ClientRect,
      pointerY: number
    ): DropHint | null => {
      const over = parseSortableId(overId)
      if (!over || over.kind === "gap") return null
      const overIsContainer =
        over.kind === "group-header" || over.kind === "flat"
      const overGroupId = overRowGroupId(over)

      // A whole group resolves to a gap strip (see canvasCollision); it never
      // produces a row line.
      if (activeRow.kind === "group-header") return null

      const sameGroup =
        overGroupId !== undefined && overGroupId === activeRow.groupId
      // Member dropped on a DIFFERENT group's container → nest (ring). On its
      // OWN group's header there's nothing to show: extraction to a new group
      // is owned by the gap strip directly above the group.
      if (overIsContainer)
        return sameGroup ? null : { kind: "into", rowId: overId }

      const edge = pointerSide(overRect, pointerY)
      // Collapse "after this member" onto "before the next member" so the gap
      // between two members of one group is a single pixel, not two.
      if (edge === "after" && over.kind === "member") {
        const idx = flattenedRows.findIndex((r) => rowSortableId(r) === overId)
        const next = flattenedRows[idx + 1]
        if (next && next.kind === "member" && next.groupId === overGroupId)
          return { kind: "line", rowId: rowSortableId(next), edge: "before" }
      }
      return { kind: "line", rowId: overId, edge }
    },
    [flattenedRows, overRowGroupId]
  )

  // onDragMove (not onDragOver): the latter only fires when the `over` row
  // CHANGES, so the before/after edge wouldn't flip as the pointer crosses a
  // row's own midpoint. onDragMove fires on every move; the equality guard
  // keeps it from re-rendering unless the resolved hint actually changes.
  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event
      const activeRow =
        over && String(active.id) !== String(over.id)
          ? flattenedRows.find((r) => rowSortableId(r) === String(active.id))
          : undefined
      const next =
        activeRow && over
          ? computeDropHint(
              activeRow,
              String(over.id),
              over.rect,
              pointerYRef.current
            )
          : null
      setDropHint((prev) => (sameDropHint(prev, next) ? prev : next))
    },
    [flattenedRows, computeDropHint]
  )

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
  const [branchesDropHint, setBranchesDropHint] = useState<LineHint>(null)

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
      const ae = event.activatorEvent as { clientY?: number }
      if (typeof ae.clientY === "number") pointerYRef.current = ae.clientY
      window.addEventListener("pointermove", handlePointerMove)
    },
    [repos, branches, handlePointerMove]
  )

  const endBranchesDrag = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMove)
    setActiveBranchesDrag(null)
    setBranchesDropHint(null)
  }, [handlePointerMove])

  const handleBranchesDragCancel = useCallback(() => {
    endBranchesDrag()
  }, [endBranchesDrag])

  // Only branch drags use the before/after line hint; repo drags land in a gap
  // strip that paints its own indicator (so there's no hint to compute).
  const handleBranchesDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event
      const a = active.data.current as
        | { kind?: "repo" | "branch"; repoId?: string }
        | undefined
      if (
        !over ||
        a?.kind !== "branch" ||
        !a.repoId ||
        String(active.id) === String(over.id)
      ) {
        setBranchesDropHint(null)
        return
      }
      const overId = String(over.id)
      const edge = pointerSide(over.rect, pointerYRef.current)
      // Collapse "after X" → "before next sibling" so a gap renders once.
      let next: LineHint = { rowId: overId, edge }
      if (edge === "after") {
        const peers = branchesByRepo(a.repoId).map((x) => `branch:${x.id}`)
        const idx = peers.indexOf(overId)
        if (idx >= 0 && idx < peers.length - 1)
          next = { rowId: peers[idx + 1]!, edge: "before" }
      }
      setBranchesDropHint((prev) => (sameLineHint(prev, next) ? prev : next))
    },
    [branchesByRepo]
  )

  /**
   * Slot a repo into the list at gap index `gapIndex` (0 = before first,
   * N = after last). Accounts for the source repo's own removal so a `repogap:N`
   * drop maps straight through. Mirrors {@link reorderGroupToGap}.
   */
  const reorderRepoToGap = useCallback(
    (repoId: string, gapIndex: number) => {
      const currentIds = sortedRepos.map((w) => w.id)
      const currentIdx = currentIds.indexOf(repoId)
      if (currentIdx < 0) return
      let target = gapIndex
      if (currentIdx < gapIndex) target -= 1
      const without = currentIds.filter((_, i) => i !== currentIdx)
      const clamped = Math.max(0, Math.min(target, without.length))
      const newOrder = [
        ...without.slice(0, clamped),
        repoId,
        ...without.slice(clamped),
      ]
      if (newOrder.join(",") === currentIds.join(",")) return
      onReorderRepos(newOrder)
    },
    [sortedRepos, onReorderRepos]
  )

  const handleBranchesDragEnd = useCallback(
    (event: DragEndEvent) => {
      const pointerY = pointerYRef.current
      endBranchesDrag()
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      // Repo reorder — the repo lands in a `repogap` strip between whole repos.
      if (activeId.startsWith("repo:") && overId.startsWith("repogap:")) {
        reorderRepoToGap(
          activeId.slice(5),
          Number(overId.slice("repogap:".length))
        )
        return
      }

      // Branch reorder — confined to a single repo. The collision already keeps
      // a branch's targets within its own repo; this guard is the belt-and-
      // braces backstop so a branch can never be filed under a foreign repo.
      if (activeId.startsWith("branch:") && overId.startsWith("branch:")) {
        const activeWs = (
          active.data.current as { repoId?: string } | undefined
        )?.repoId
        const overWs = (over.data.current as { repoId?: string } | undefined)
          ?.repoId
        if (!activeWs || activeWs !== overWs) return
        const currentIds = branchesByRepo(activeWs).map((a) => a.id)
        const after = pointerSide(over.rect, pointerY) === "after"
        const newOrder = reorderToSide(
          currentIds,
          activeId.slice(7),
          overId.slice(7),
          after
        )
        if (newOrder.join(",") !== currentIds.join(","))
          onReorderBranches(activeWs, newOrder)
      }
    },
    [branchesByRepo, onReorderBranches, reorderRepoToGap, endBranchesDrag]
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
      const pointerY = pointerYRef.current
      endDrag()
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
        const insertAfter = pointerSide(over.rect, pointerY) === "after"
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

      // before/after comes from the live pointer vs the over row's midpoint —
      // the exact same rule the drop hint uses — so the commit always lands
      // where the indicator pointed. (Visual `after X` normalizes to `before
      // X+1`, but both resolve to this same gap index, so no extra handling.)
      const insertAfter = pointerSide(over.rect, pointerY) === "after"
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
    [flattenedRows, iframeLayerGroups, onMoveMember, reorderGroupToGap, endDrag]
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
          collisionDetection={branchesCollision}
          onDragStart={handleBranchesDragStart}
          onDragMove={handleBranchesDragMove}
          onDragEnd={handleBranchesDragEnd}
          onDragCancel={handleBranchesDragCancel}
        >
          <BranchesDropHintContext.Provider value={branchesDropHint}>
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
                {/* gap-0 + RepoGap strips (not flex `gap`) so repos reorder by
                  dropping between whole repos, exactly like the canvas list. */}
                <SidebarMenu className="gap-0">
                  <SortableContext
                    items={sortedRepos.map((w) => `repo:${w.id}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sortedRepos.map((repo, repoIdx) => {
                      const repoBranches = branchesByRepo(repo.id)
                      const isRepoDragging =
                        activeBranchesDrag?.kind === "repo" &&
                        activeBranchesDrag.repo.id === repo.id
                      return (
                        <Fragment key={repo.id}>
                          <RepoGap index={repoIdx} />
                          <Collapsible
                            asChild
                            defaultOpen
                            className="group/collapsible"
                          >
                            <SidebarMenuItem
                              className="!group-hover/menu-item:[&>[data-sidebar=menu-action]]:opacity-100"
                              style={
                                isRepoDragging ? { opacity: 0 } : undefined
                              }
                            >
                              <BranchesSortableRow
                                id={`repo:${repo.id}`}
                                kind="repo"
                                className="group/workspace-row cursor-grab active:cursor-grabbing"
                                data-settings-open={
                                  settingsRepoId === repo.id || undefined
                                }
                              >
                                <SidebarMenuButton
                                  className="!pr-2 !transition-[width,height] group-focus-within/workspace-row:!pr-14 group-hover/workspace-row:!pr-14 group-data-[settings-open]/workspace-row:!pr-14"
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

                                {/* The Repo row collapses to two affordances:
                                    the primary "New Workspace" button and a `…`
                                    overflow menu (PRD #314). */}
                                <SidebarMenuAction
                                  className="right-7 group-focus-within/workspace-row:opacity-100 group-hover/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100 md:opacity-0"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setNewWorkspaceBaseBranch(null)
                                    setNewWorkspaceRepoId(repo.id)
                                  }}
                                  title="New Workspace"
                                >
                                  <Plus />
                                </SidebarMenuAction>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <SidebarMenuAction
                                      className="group-focus-within/workspace-row:opacity-100 group-hover/workspace-row:opacity-100 group-data-[settings-open]/workspace-row:opacity-100 aria-expanded:opacity-100 md:opacity-0"
                                      onClick={(e) => e.stopPropagation()}
                                      title="More"
                                    >
                                      <MoreHorizontal />
                                    </SidebarMenuAction>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    side="right"
                                    align="start"
                                    className="w-48"
                                  >
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setBranchPickerRepoId(repo.id)
                                      }
                                    >
                                      <GitBranch />
                                      Open existing branch
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => setSettingsRepoId(repo.id)}
                                    >
                                      <Settings />
                                      Settings
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                                {/* "Open existing branch" reattaches to a
                                    remote branch (flow:"from-branch", no new
                                    branch, no prompt, autoNamedBranch:false) —
                                    a single Enter action. Forking lives in the
                                    branch menu's "New branch from here…", which
                                    opens the create dialog based on that branch
                                    (#353). */}
                                <Dialog
                                  open={branchPickerRepoId === repo.id}
                                  onOpenChange={(open) =>
                                    setBranchPickerRepoId(open ? repo.id : null)
                                  }
                                >
                                  <DialogContent className="max-w-sm gap-0 p-0">
                                    <DialogHeader className="px-4 pt-4 pb-2">
                                      <DialogTitle>
                                        Open existing branch
                                      </DialogTitle>
                                    </DialogHeader>
                                    <BranchPicker
                                      owner={repo.repoOwner}
                                      repo={repo.repoName}
                                      onSelect={(branch) => {
                                        setBranchPickerRepoId(null)
                                        onCreateBranchFromGitBranch(
                                          repo.id,
                                          branch
                                        )
                                      }}
                                    />
                                  </DialogContent>
                                </Dialog>
                                <Dialog
                                  open={settingsRepoId === repo.id}
                                  onOpenChange={(open) =>
                                    setSettingsRepoId(open ? repo.id : null)
                                  }
                                >
                                  <DialogContent className="max-w-sm">
                                    <DialogHeader className="sr-only">
                                      <DialogTitle>Settings</DialogTitle>
                                    </DialogHeader>
                                    <RepoSettings
                                      repo={repo}
                                      onUpdate={onUpdateRepo}
                                      onRemove={() => {
                                        setSettingsRepoId(null)
                                        setPendingDeleteRepoId(repo.id)
                                      }}
                                      onClose={() => setSettingsRepoId(null)}
                                    />
                                  </DialogContent>
                                </Dialog>
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
                                                  triggerEdit:
                                                    triggerBranchRename,
                                                  onCloseAutoFocus:
                                                    onBranchMenuCloseAutoFocus,
                                                }) => (
                                                  <>
                                                    <div
                                                      className={`group/branch-row grid grid-cols-[1fr_auto] items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground${isPanelActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}${isLoading ? "opacity-50" : ""}`}
                                                      onClick={(e) => {
                                                        e.stopPropagation()
                                                        onSelectBranch(
                                                          branch.id,
                                                          {
                                                            expandPanel: false,
                                                          }
                                                        )
                                                      }}
                                                      onDoubleClick={(e) => {
                                                        e.stopPropagation()
                                                        onSelectBranch(
                                                          branch.id
                                                        )
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
                                                          {isLoading ? (
                                                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sidebar-foreground/70" />
                                                          ) : isActive ? (
                                                            <GripSpinner className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/70" />
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
                                                              branch={
                                                                branch.ref
                                                              }
                                                              colorKey={
                                                                branch.id
                                                              }
                                                              colorIndex={
                                                                branch.colorIndex
                                                              }
                                                              className="px-1.5 py-0 text-[11px]"
                                                              onRename={(
                                                                next
                                                              ) => {
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
                                                            diffStats.get(
                                                              branch.id
                                                            )
                                                          const hasStats =
                                                            stats &&
                                                            (stats.additions >
                                                              0 ||
                                                              stats.deletions >
                                                                0)
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
                                                                  <BranchOverflowMenuContent
                                                                    branch={
                                                                      branch
                                                                    }
                                                                    repo={repo}
                                                                    onPlay={
                                                                      onPlayBranch
                                                                    }
                                                                    onRename={
                                                                      triggerBranchRename
                                                                    }
                                                                    onUpdateBranch={
                                                                      onUpdateBranch
                                                                    }
                                                                    onNewBranchFromHere={() => {
                                                                      setNewWorkspaceBaseBranch(
                                                                        branch.ref ??
                                                                          null
                                                                      )
                                                                      setNewWorkspaceRepoId(
                                                                        branch.repoId
                                                                      )
                                                                    }}
                                                                    onRestartDevServer={
                                                                      onRestartDevServer
                                                                    }
                                                                    onRestart={
                                                                      onRefreshBranch
                                                                    }
                                                                    onShowRoutes={
                                                                      onShowRoutes
                                                                    }
                                                                    onCreatePr={
                                                                      onCreatePr
                                                                    }
                                                                    onRebase={
                                                                      onRebaseOnDefault
                                                                    }
                                                                    onDelete={
                                                                      setPendingDeleteBranchId
                                                                    }
                                                                    onCloseAutoFocus={
                                                                      onBranchMenuCloseAutoFocus
                                                                    }
                                                                    isBusy={
                                                                      isActive
                                                                    }
                                                                  />
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
                        </Fragment>
                      )
                    })}
                    <RepoGap index={sortedRepos.length} />
                  </SortableContext>
                </SidebarMenu>

                {repos.length === 0 && !showPicker && (
                  <div className="py-8 text-center text-xs text-sidebar-foreground/50">
                    No workspaces yet
                  </div>
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          </BranchesDropHintContext.Provider>
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
          collisionDetection={canvasCollision}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SidebarGroup>
            <SidebarGroupLabel>Canvas</SidebarGroupLabel>
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
                                    onCloseAutoFocus: onGroupMenuCloseAutoFocus,
                                  }) => (
                                    <SortableRow
                                      id={`group:${group.id}`}
                                      groupId={group.id}
                                      className="group/frame-group-row cursor-grab active:cursor-grabbing"
                                    >
                                      <SidebarMenuButton
                                        className="!pr-2 !transition-[width,height] group-focus-within/frame-group-row:!pr-7 group-hover/frame-group-row:!pr-7 group-has-data-[state=open]/frame-group-row:!pr-7 has-[[data-editable-text=editing]]:overflow-visible"
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
              </DropHintContext.Provider>
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
        const repo = newWorkspaceRepoId
          ? repos.find((w) => w.id === newWorkspaceRepoId)
          : null
        return repo ? (
          <CreateBranchDialog
            open={true}
            onOpenChange={(open) => {
              if (!open) {
                setNewWorkspaceRepoId(null)
                setNewWorkspaceBaseBranch(null)
              }
            }}
            defaultBranch={repo.defaultBranch}
            baseBranch={newWorkspaceBaseBranch ?? undefined}
            repoOwner={repo.repoOwner}
            repoName={repo.repoName}
            markdownLayers={markdownLayers}
            onSubmit={(specs) => onCreateWorkspace(repo.id, specs)}
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
