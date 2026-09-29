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
  CaretRightIcon,
  DotsThreeIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PencilSimpleIcon,
  PlusIcon,
  SidebarSimpleIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { IconButton } from "@workspace/ui/components/icon-button"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { isLocalBuild } from "@/lib/local-mode"
import { useDiffStats } from "@/hooks/use-diff-stats"
import { useGitHubTokenAvailable } from "@/hooks/use-github-token"
import { useUnsavedWork } from "@/hooks/use-unsaved-work"
import { useChatSessions } from "@/lib/yjs/react"
import { hasGitHubRemote, repoShortName } from "@/lib/repo-identity"
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
import { frameWorkspaceOf } from "@/components/canvas/frame-nav"
import { CompactWorkspaceMention } from "@/components/canvas/workspace-list"
import { groupBranchId } from "@/lib/canvas/group-workspace"
import { sortForSidebar } from "@/lib/sidebar-order"
import {
  parseSidebarRowId,
  resolveRepoListDrop,
  resolveSidebarDrop,
  sidebarRowId,
  type MoveMemberTarget,
  type RepoListDropHint,
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
import { listRepoBranches } from "@/lib/github-actions"
import { DeleteBranchDialog } from "@/components/delete-branch-dialog"
import { RecreateBranchDialog } from "@/components/recreate-branch-dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { BranchPicker } from "@/components/branch-picker"
import { CreateBranchDialog } from "@/components/create-branch-dialog"
import type { ComposerSpec } from "@/lib/branch-create-planner"
import { BranchOverflowMenuContent } from "@/components/panels/branch-overflow-menu"
import { checkBranchRename } from "@/lib/branch-rename"
import { hasWorkspaceTitle, workspaceLabel } from "@/lib/workspace-label"
import { InputDialog } from "@/components/home/input-dialog"
import { branchRowClassName } from "@/components/panels/branch-row-class"
import {
  useIsFrameHighlighted,
  useIsWorkspaceHighlighted,
  useWorkspaceHoverProps,
  workspaceHoverStore,
} from "@/lib/workspace-hover-store"
import { WorkspaceStatusIcon } from "@/components/panels/workspace-status-icon"
import { WorkspaceMention } from "@/components/workspace-mention"
import { WorkspaceHoverCard } from "@/components/workspace-hover-card"

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
 * The single before/after indicator for the Branches section, resolved by
 * {@link resolveRepoListDrop} and normalized so each gap is one pixel. No
 * "into" — repos and branches only reorder, never nest.
 */
type LineHint = RepoListDropHint | null

const BranchesDropHintContext = createContext<LineHint>(null)

function sameLineHint(a: LineHint, b: LineHint): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.rowId === b.rowId && a.edge === b.edge
}

/** Is droppable `target` a legal landing spot for the active Workspaces drag? */
function branchesEligible(
  active: { kind?: string; repoId?: string } | undefined,
  target: { kind?: string; repoId?: string } | undefined
): boolean {
  // A Workspace reorders only among its own Repo's Workspaces, which sit
  // together in the flat list.
  return (
    active?.kind === "branch" &&
    target?.kind === "branch" &&
    target.repoId === active.repoId
  )
}

/**
 * Pointer-driven collision for the Workspaces list, mirroring {@link
 * canvasCollision} but with the section's constraint folded in: only a
 * Workspace of the dragged one's own Repo is eligible. A Workspace dragged over
 * another Repo's rows yields no target at all, rather than a misleading
 * indicator.
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
  // Drags clamp to their Repo's span of the list so a Workspace never lights
  // up a target while the pointer is over another Repo's rows.
  if (y < blockTop || y > blockBottom) return []
  return [best]
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
      ref={setNodeRef}
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
 * A whole-row sortable for the flat Workspaces list (#884). Same interaction
 * as the Canvas section's `SortableRow` (drag the whole row, source goes
 * transparent, the `<DragOverlay>` paints the floating preview, a static
 * `<DropLine>` marks the target) but with the simpler before/after-only
 * semantics this section needs — there is no "into" nesting here.
 *
 * Drops are only valid within the *same repo* (`repoId`): the indicator stays
 * dark unless the dragged row is a compatible target, which is what visually
 * enforces the within-repo constraint.
 */
function BranchesSortableRow({
  id,
  repoId,
  className,
  children,
  ...rest
}: {
  id: string
  /** Owning repo — used to confine drops to one repo. */
  repoId: string
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id,
    data: { kind: "branch", repoId },
  })
  // Same model as the Canvas SortableRow: the parent resolves ONE pointer-based,
  // gap-normalized hint and we render only the part that targets this row.
  const hint = useContext(BranchesDropHintContext)
  const indicator = hint && hint.rowId === id ? hint.edge : null
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
      {/* Workspace rows sit flush (`gap-0`), like the Canvas list's rows. */}
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
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-canvas-selection" />
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
  /**
   * Opens Canvas settings on Repositories: where the empty Workspaces
   * section's Add repository goes (#884).
   */
  onOpenCanvasSettings: () => void
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
  /** Snapshot-restore the sandbox, preserving the working tree. */
  onRefreshBranch: (id: string) => void
  /** Destructive reclone from git — discards the working tree. */
  onRecreateBranch: (id: string) => void | Promise<void>
  /** Re-run a failed Workspace's setup (#791). */
  onRetryBranch: (id: string) => void
  /** Mark a Workspace Done (#976), and Reopen one. */
  onMarkBranchDone: (id: string) => void
  onReopenBranch: (id: string) => void
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
  /** Persist the room-shared order of one repo's Branch list. */
  onReorderBranches: (repoId: string, orderedIds: string[]) => void
  /**
   * Move a single member across (or within) groups. `target` either points
   * into an existing group at a gap index (as the sidebar shows it), or asks
   * for a new single-member group to be created at a given sidebar slot.
   */
  onMoveMember: (member: GroupMember, target: MoveMemberTarget) => void
  onRenameIframeLayerGroup: (groupId: string, name: string) => void
  onRemoveIframeLayerGroup: (groupId: string) => void
  onCollapseSidebar?: () => void
  activeBranchIds?: Set<string>
  chatPanelBranchId?: string | null
  /** GitHub-polled PR state per branch. Lifted to the parent so the sidebar
   *  and chat panel share one poller and can't disagree about whether a PR
   *  exists for a branch. */
  branchPrs: Map<string, BranchPrInfo>
  /**
   * Set by the Canvas to open New Workspace on a Project (the getting-started
   * checklist, #780). Each new `seq` opens it once.
   */
  newWorkspaceRequest?: { repoId: string; seq: number } | null
  /** Pinned under the scrolling lists (the getting-started checklist, #780). */
  footer?: React.ReactNode
}

/** A sidebar Layer awaiting its delete confirm. */
type PendingRemoveLayer = {
  kind: "iframe-layer" | "markdown-layer"
  id: string
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
  onOpenCanvasSettings,
  onCreateBranchFromGitBranch,
  onCreateWorkspace,
  onRebaseOnDefault,
  onRestartDevServer,
  onCreatePr,
  onRefreshBranch,
  onRecreateBranch,
  onRetryBranch,
  onMarkBranchDone,
  onReopenBranch,
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
  onReorderBranches,
  onMoveMember,
  onRenameIframeLayerGroup,
  onRemoveIframeLayerGroup,
  onCollapseSidebar,
  activeBranchIds,
  chatPanelBranchId,
  branchPrs,
  newWorkspaceRequest = null,
  footer,
}: RoomSidebarProps) {
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
  // Adjusted during render, like the add-project request above.
  const [seenNewWorkspaceRequest, setSeenNewWorkspaceRequest] =
    useState(newWorkspaceRequest)
  if (newWorkspaceRequest !== seenNewWorkspaceRequest) {
    setSeenNewWorkspaceRequest(newWorkspaceRequest)
    if (newWorkspaceRequest) {
      setNewWorkspaceBaseBranch(null)
      setNewWorkspaceRepoId(newWorkspaceRequest.repoId)
    }
  }
  const [pendingDeleteBranchId, setPendingDeleteBranchId] = useState<
    string | null
  >(null)
  const [pendingRecreateBranchId, setPendingRecreateBranchId] = useState<
    string | null
  >(null)
  const [pendingRenameBranchId, setPendingRenameBranchId] = useState<
    string | null
  >(null)
  // Sidebar Layer / Group deletes have no undo, so they go through a confirm
  // (issue #724). The canvas's own Delete key is unchanged.
  const [pendingRemoveLayer, setPendingRemoveLayer] =
    useState<PendingRemoveLayer | null>(null)
  const [pendingRemoveGroupId, setPendingRemoveGroupId] = useState<
    string | null
  >(null)
  // Per-repo cache of remote branch names, fetched lazily on first
  // render of a repo and refreshed whenever the repo list changes.
  // Used to block inline-renames that would collide with an existing branch.
  const [remoteBranchesByRepo, setRemoteBranchesByRepo] = useState<
    Map<string, Set<string>>
  >(new Map())
  const diffStats = useDiffStats(branches, repos)
  // Whether the GitHub API is reachable at all, for the delete dialog's
  // remote-branch offer (issue #741). False until probed, so the destructive
  // toggle is never shown on a guess.
  const githubTokenAvailable = useGitHubTokenAvailable()
  // What the delete confirms say is lost (issue #776): the Chat Sessions and
  // frames each Workspace cascades to, and its checkout's unpushed work, read
  // only while a confirm is open.
  const chatSessions = useChatSessions()
  const deleteTargets = useMemo(
    () =>
      pendingDeleteBranchId
        ? branches.filter((b) => b.id === pendingDeleteBranchId)
        : [],
    [branches, pendingDeleteBranchId]
  )
  const deleteTargetRepo = repos.find((r) => r.id === deleteTargets[0]?.repoId)
  const unsavedWork = useUnsavedWork(
    deleteTargets,
    deleteTargetRepo?.defaultBranch,
    deleteTargets.length > 0
  )
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
      onRemove: (id) => setPendingRemoveLayer({ kind: "iframe-layer", id }),
    },
    "markdown-layer": {
      Row: DocumentRow as AnyRowDispatcher["Row"],
      Menu: DocumentRowMenu as AnyRowDispatcher["Menu"],
      isSelected: (id) => selectedDocumentLayerIds.has(id),
      onSelect: onSelectDocument,
      onActivate: onZoomToDocument,
      onRename: onRenameDocument,
      onRemove: (id) => setPendingRemoveLayer({ kind: "markdown-layer", id }),
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

  // --- The Workspaces list (#884): every Repo's Workspaces, flattened ---

  /**
   * Repos in effective sidebar order: manual `sidebarOrder` wins, falling back
   * to alphabetical by repo full name for any repo never dragged. Each Repo's
   * Workspaces sort the same way, by `createdAt`, and the list flattens them
   * Repo by Repo.
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

  const reposById = useMemo(
    () => new Map(sortedRepos.map((r) => [r.id, r])),
    [sortedRepos]
  )
  const flatBranches = useMemo(
    () => sortedRepos.flatMap((r) => branchesByRepo(r.id)),
    [sortedRepos, branchesByRepo]
  )
  // Done Workspaces (#976) leave the list for a collapsed Done section at its
  // bottom, most recently done first.
  const activeBranches = useMemo(
    () => flatBranches.filter((b) => !b.doneAt),
    [flatBranches]
  )
  const doneBranches = useMemo(
    () =>
      flatBranches
        .filter((b) => b.doneAt)
        .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    [flatBranches]
  )
  const [doneOpen, setDoneOpen] = useState(false)
  // With one repository the list never mentions it (#884).
  const showRepoNames = sortedRepos.length > 1
  // New workspace starts in the Repo used last: the newest Workspace's.
  const lastUsedRepoId = useMemo(() => {
    let newest: BranchData | undefined
    for (const b of branches) {
      if (!reposById.has(b.repoId)) continue
      if (!newest || b.createdAt > newest.createdAt) newest = b
    }
    return newest?.repoId ?? sortedRepos[0]?.id ?? null
  }, [branches, reposById, sortedRepos])

  const [activeBranchesDrag, setActiveBranchesDrag] =
    useState<BranchData | null>(null)
  const [branchesDropHint, setBranchesDropHint] = useState<LineHint>(null)

  const handleBranchesDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id)
      setActiveBranchesDrag(
        branches.find((b) => `branch:${b.id}` === id) ?? null
      )
      const ae = event.activatorEvent as { clientY?: number }
      if (typeof ae.clientY === "number") pointerYRef.current = ae.clientY
      window.addEventListener("pointermove", handlePointerMove)
    },
    [branches, handlePointerMove]
  )

  const endBranchesDrag = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMove)
    setActiveBranchesDrag(null)
    setBranchesDropHint(null)
  }, [handlePointerMove])

  const handleBranchesDragCancel = useCallback(() => {
    endBranchesDrag()
  }, [endBranchesDrag])

  /** Repos in sidebar order with their branch ids, for Sidebar Drop. */
  const dropRepos = useMemo(
    () =>
      sortedRepos.map((r) => ({
        id: r.id,
        branchIds: branchesByRepo(r.id)
          .filter((b) => !b.doneAt)
          .map((b) => b.id),
      })),
    [sortedRepos, branchesByRepo]
  )

  /** The Sidebar Drop decision (hint + intent) for the Workspaces list. */
  const resolveBranchesDrop = useCallback(
    (activeId: string, over: { id: string | number; rect: ClientRect }) =>
      resolveRepoListDrop({
        repos: dropRepos,
        activeId,
        overId: String(over.id),
        side: pointerSide(over.rect, pointerYRef.current),
      }),
    [dropRepos]
  )

  const handleBranchesDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event
      const next = over
        ? resolveBranchesDrop(String(active.id), over).hint
        : null
      setBranchesDropHint((prev) => (sameLineHint(prev, next) ? prev : next))
    },
    [resolveBranchesDrop]
  )

  const handleBranchesDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      const intent = over
        ? resolveBranchesDrop(String(active.id), over).intent
        : null
      endBranchesDrag()
      // Only Workspaces drag here; Repos keep their order from Canvas settings.
      if (intent?.kind === "reorder-branches")
        onReorderBranches(intent.repoId, intent.orderedIds)
    },
    [resolveBranchesDrop, onReorderBranches, endBranchesDrag]
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

  /**
   * One Workspace row: state icon, title (renamed inline), PR badge or line
   * count, and its … menu. The Done section (#976) draws the same row.
   */
  const renderBranchRow = (branch: BranchData, repo: RepoData) => {
    const isActive = activeBranchIds?.has(branch.id) ?? false
    const isPanelActive = chatPanelBranchId === branch.id
    const pr = branchPrs.get(branch.id)
    return (
      <SidebarMenuItem>
        <WithEditableRef>
          {({
            ref: branchRef,
            triggerEdit: triggerBranchRename,
            onCloseAutoFocus: onBranchMenuCloseAutoFocus,
          }) => (
            <BranchRowShell
              branchId={branch.id}
              isPanelActive={isPanelActive}
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
              <SidebarMenuButton
                asChild
                className="!bg-transparent !pr-0 hover:!bg-transparent"
                isActive={false}
              >
                <div>
                  {(() => {
                    const stats = diffStats.get(branch.id)
                    const hasStats =
                      stats && (stats.additions > 0 || stats.deletions > 0)
                    // Hidden while the row's menu shows in its place.
                    const underMenu =
                      "md:group-focus-within/branch-row:hidden md:group-hover/branch-row:hidden md:group-has-data-[menu-visible]/branch-row:hidden"
                    return (
                      // The shared Workspace mention (#974): state icon,
                      // title, and the PR badge, else the line count
                      // (#963). The badge drops before the title truncates.
                      <WorkspaceMention
                        branch={branch}
                        prOverride={pr ?? null}
                        endClassName={underMenu}
                        fallback={
                          hasStats ? (
                            <span className="flex items-center gap-1 font-mono text-3xs">
                              <span className="text-success">
                                +{stats.additions}
                              </span>
                              <span className="text-destructive">
                                -{stats.deletions}
                              </span>
                            </span>
                          ) : null
                        }
                        icon={
                          <WorkspaceStatusIcon
                            branch={branch}
                            context={{
                              agentWorking: isActive,
                            }}
                            onRetry={() => onRetryBranch(branch.id)}
                            onRecreate={() =>
                              setPendingRecreateBranchId(branch.id)
                            }
                          />
                        }
                        name={
                          branch.ref ? (
                            <span
                              className={cn(
                                "flex max-w-full min-w-0 has-[[data-editable-text=editing]]:overflow-visible",
                                !hasWorkspaceTitle(branch) &&
                                  "font-mono text-xs"
                              )}
                              // The sortable row's keyboard sensor eats
                              // Space; keep the editor's keys here.
                              onKeyDown={(e) => {
                                if ((e.target as HTMLElement).isContentEditable)
                                  e.stopPropagation()
                              }}
                            >
                              <EditableText
                                ref={branchRef}
                                as="span"
                                value={workspaceLabel(branch)}
                                onCommit={(next) => {
                                  // Renames the title only (#881); the branch
                                  // moves through Rename branch in the menu.
                                  const title = next.trim()
                                  if (
                                    !title ||
                                    title === workspaceLabel(branch)
                                  )
                                    return
                                  onUpdateBranch(branch.id, { title })
                                }}
                                className="min-w-0"
                                viewClassName="truncate"
                                editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
                              />
                            </span>
                          ) : (
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              Creating…
                            </span>
                          )
                        }
                      />
                    )
                  })()}
                </div>
              </SidebarMenuButton>
              <div className="group/slot flex shrink-0 items-center pr-1 pl-2">
                {(() => {
                  const stats = diffStats.get(branch.id)
                  const hasStats =
                    stats && (stats.additions > 0 || stats.deletions > 0)
                  return (
                    <>
                      {showRepoNames && (
                        <span className="truncate pr-1 pl-1.5 text-xs text-muted-foreground md:group-focus-within/branch-row:hidden md:group-hover/branch-row:hidden md:group-has-data-[menu-visible]/slot:hidden">
                          {repoShortName(repo)}
                        </span>
                      )}
                      <BranchDropdownSlot
                        menuContent={
                          <BranchOverflowMenuContent
                            branch={branch}
                            repo={repo}
                            onPlay={onPlayBranch}
                            onRetry={onRetryBranch}
                            hasChanges={!!hasStats}
                            onRename={triggerBranchRename}
                            onRenameBranch={setPendingRenameBranchId}
                            onNewBranchFromHere={() => {
                              setNewWorkspaceBaseBranch(branch.ref ?? null)
                              setNewWorkspaceRepoId(branch.repoId)
                            }}
                            onRestartDevServer={onRestartDevServer}
                            onRestart={onRefreshBranch}
                            onRecreate={setPendingRecreateBranchId}
                            onShowRoutes={onShowRoutes}
                            onCreatePr={onCreatePr}
                            pr={pr}
                            onRebase={onRebaseOnDefault}
                            onMarkDone={onMarkBranchDone}
                            onReopen={onReopenBranch}
                            onDelete={setPendingDeleteBranchId}
                            onCloseAutoFocus={onBranchMenuCloseAutoFocus}
                            isBusy={isActive}
                          />
                        }
                      />
                    </>
                  )
                })()}
              </div>
            </BranchRowShell>
          )}
        </WithEditableRef>
      </SidebarMenuItem>
    )
  }

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
            asChild
          >
            <button
              className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
              onClick={onCollapseSidebar}
            >
              <SidebarSimpleIcon />
            </button>
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <DndContext
            // Stable id keeps dnd-kit's a11y `aria-describedby` deterministic
            // across SSR/hydration (see file-dnd.tsx for the full rationale).
            id="room-sidebar-branches"
            sensors={sensors}
            collisionDetection={branchesCollision}
            onDragStart={handleBranchesDragStart}
            onDragMove={handleBranchesDragMove}
            onDragEnd={handleBranchesDragEnd}
            onDragCancel={handleBranchesDragCancel}
          >
            <BranchesDropHintContext.Provider value={branchesDropHint}>
              <SidebarGroup className="pt-0">
                <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
                {sortedRepos.length > 0 && (
                  <>
                    {/* + creates a Workspace in one step (#884); the rarer
                        Open existing git branch sits in the … beside it. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label="More workspace actions"
                          tooltipSide="right"
                          asChild
                        >
                          <SidebarGroupAction className="top-1.5 right-9">
                            <DotsThreeIcon />
                          </SidebarGroupAction>
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="bottom" align="end">
                        {sortedRepos.length === 1 ? (
                          <DropdownMenuItem
                            onClick={() =>
                              setBranchPickerRepoId(sortedRepos[0]!.id)
                            }
                          >
                            <GitBranchIcon />
                            Open existing git branch
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <GitBranchIcon />
                              Open existing git branch
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {sortedRepos.map((repo) => (
                                <DropdownMenuItem
                                  key={repo.id}
                                  onClick={() => setBranchPickerRepoId(repo.id)}
                                >
                                  {repoShortName(repo)}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <IconButton
                      label="New workspace"
                      tooltipSide="right"
                      asChild
                    >
                      <SidebarGroupAction
                        className="top-1.5"
                        onClick={() => {
                          setNewWorkspaceBaseBranch(null)
                          setNewWorkspaceRepoId(lastUsedRepoId)
                        }}
                      >
                        <PlusIcon />
                      </SidebarGroupAction>
                    </IconButton>
                  </>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SortableContext
                      items={activeBranches.map((b) => `branch:${b.id}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      {activeBranches.map((branch) => {
                        const repo = reposById.get(branch.repoId)
                        if (!repo) return null
                        return (
                          <BranchesSortableRow
                            key={branch.id}
                            id={`branch:${branch.id}`}
                            repoId={repo.id}
                            className="cursor-grab active:cursor-grabbing"
                          >
                            {renderBranchRow(branch, repo)}
                          </BranchesSortableRow>
                        )
                      })}
                    </SortableContext>
                  </SidebarMenu>
                  {doneBranches.length > 0 && (
                    <Collapsible
                      open={doneOpen}
                      onOpenChange={setDoneOpen}
                      className="group/done-section mt-1"
                    >
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton className="text-sidebar-foreground/70">
                              <CaretRightIcon className="transition-transform group-data-[state=open]/done-section:rotate-90" />
                              <span>Done ({doneBranches.length})</span>
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                        </SidebarMenuItem>
                      </SidebarMenu>
                      <CollapsibleContent>
                        <SidebarMenu className="mt-1">
                          {doneBranches.map((branch) => {
                            const repo = reposById.get(branch.repoId)
                            if (!repo) return null
                            return (
                              <Fragment key={branch.id}>
                                {renderBranchRow(branch, repo)}
                              </Fragment>
                            )
                          })}
                        </SidebarMenu>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {sortedRepos.length === 0 && (
                    // A canvas with no repository says why, and where to add
                    // one: Canvas settings, the one place repositories live.
                    // Styled like the Canvas list's "No frames yet" below.
                    <div className="flex flex-col items-center gap-3 py-8">
                      <p className="text-center text-xs text-balance text-sidebar-foreground/50">
                        Workspaces need a repository to run.
                      </p>
                      {/* The getting-started checklist below already leads
                          with Add repository; one button is enough. */}
                      {footer ? null : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={onOpenCanvasSettings}
                        >
                          Add repository
                        </Button>
                      )}
                    </div>
                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            </BranchesDropHintContext.Provider>
            <DragOverlay dropAnimation={null}>
              {activeBranchesDrag ? (
                <div className="rounded-md bg-sidebar opacity-95 shadow-lg ring-1 ring-sidebar-border">
                  <SidebarMenuButton asChild isActive={false}>
                    <div>
                      <GitBranchIcon className="shrink-0 text-sidebar-foreground/70" />
                      {activeBranchesDrag.ref ? (
                        <span
                          className={cn(
                            "truncate",
                            !hasWorkspaceTitle(activeBranchesDrag) &&
                              "font-mono text-xs"
                          )}
                        >
                          {workspaceLabel(activeBranchesDrag)}
                        </span>
                      ) : (
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          Creating…
                        </span>
                      )}
                    </div>
                  </SidebarMenuButton>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

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
                                            editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
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
                                                setPendingRemoveGroupId(
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
        {(() => {
          const branch = pendingDeleteBranchId
            ? branches.find((a) => a.id === pendingDeleteBranchId)
            : null
          const repo = branch
            ? repos.find((w) => w.id === branch.repoId)
            : undefined
          return (
            <DeleteBranchDialog
              open={!!branch}
              onOpenChange={(open) => {
                if (!open) setPendingDeleteBranchId(null)
              }}
              branchName={branch ? workspaceLabel(branch) : ""}
              // Remote deletion goes through the GitHub API, so it is only
              // offered when the API can actually serve it: a token resolves
              // and this Project names a GitHub remote (issue #741).
              canDeleteOnRemote={githubTokenAvailable && hasGitHubRemote(repo)}
              chatCount={
                branch
                  ? chatSessions.filter((c) => c.branchId === branch.id).length
                  : 0
              }
              frameCount={
                branch
                  ? iframeLayers.filter((l) => l.branchId === branch.id).length
                  : 0
              }
              openPrNumber={
                branch?.prState === "open" ? branch.prNumber : undefined
              }
              work={branch ? unsavedWork.get(branch.id) : undefined}
              localBranchKept={isLocalBuild}
              onConfirm={async ({ deleteOnRemote }) => {
                if (!branch) return
                await onRemoveBranch(branch.id, { deleteOnRemote })
                setPendingDeleteBranchId(null)
              }}
            />
          )
        })()}
        {(() => {
          const branch = pendingRenameBranchId
            ? branches.find((a) => a.id === pendingRenameBranchId)
            : null
          return (
            <InputDialog
              open={!!branch}
              onOpenChange={(open) => {
                if (!open) setPendingRenameBranchId(null)
              }}
              title="Rename branch"
              description="Renames the git branch. The workspace keeps its title."
              initialValue={branch?.ref ?? ""}
              submitLabel="Rename"
              submittingLabel="Renaming…"
              errorMessage="That branch name is empty or already taken."
              onSubmit={async (next) => {
                if (!branch) return
                const check = checkBranchRename({
                  next,
                  current: branch.ref,
                  remoteBranches: remoteBranchesByRepo.get(branch.repoId),
                  otherLocalRefs: isLocalBuild
                    ? branches
                        .filter(
                          (a) =>
                            a.repoId === branch.repoId && a.id !== branch.id
                        )
                        .map((a) => a.ref)
                    : [],
                })
                if (check.kind === "invalid") {
                  throw new Error("Invalid branch name")
                }
                if (check.kind === "rename") {
                  onRenameBranch(branch.id, check.branch)
                }
              }}
            />
          )
        })()}
        {(() => {
          const branch = pendingRecreateBranchId
            ? branches.find((a) => a.id === pendingRecreateBranchId)
            : null
          return (
            <RecreateBranchDialog
              open={!!branch}
              onOpenChange={(open) => {
                if (!open) setPendingRecreateBranchId(null)
              }}
              branchName={branch?.ref ?? ""}
              onConfirm={async () => {
                if (!branch) return
                // The confirm stays open ("Recreating…") until this settles;
                // a failure rejects and shows inline for a retry.
                await onRecreateBranch(branch.id)
                setPendingRecreateBranchId(null)
              }}
            />
          )
        })()}
        {newWorkspaceRepoId && reposById.has(newWorkspaceRepoId) ? (
          <CreateBranchDialog
            open={true}
            onOpenChange={(open) => {
              if (!open) {
                setNewWorkspaceRepoId(null)
                setNewWorkspaceBaseBranch(null)
              }
            }}
            repos={sortedRepos}
            repoId={newWorkspaceRepoId}
            baseBranch={newWorkspaceBaseBranch ?? undefined}
            markdownLayers={markdownLayers}
            onSubmit={(specs) => {
              // One create per Repo, each keeping its rows' order.
              for (const repoId of new Set(specs.map((s) => s.repoId))) {
                onCreateWorkspace(
                  repoId,
                  specs
                    .filter((s) => s.repoId === repoId)
                    .map(({ repoId: _, ...spec }) => spec)
                )
              }
            }}
          />
        ) : null}
        {(() => {
          // "Open existing git branch" reattaches to a remote branch
          // (flow:"from-branch", no new branch, no prompt,
          // autoNamedBranch:false): a single Enter action. Forking lives in
          // the Workspace menu's "New workspace from here…" (#353).
          const repo = branchPickerRepoId
            ? reposById.get(branchPickerRepoId)
            : undefined
          return (
            <Dialog
              open={!!repo}
              onOpenChange={(open) => {
                if (!open) setBranchPickerRepoId(null)
              }}
            >
              <DialogContent className="max-w-sm gap-0 p-0">
                <DialogHeader className="px-5 pt-5 pb-2">
                  <DialogTitle>Open existing git branch</DialogTitle>
                </DialogHeader>
                {repo ? (
                  <BranchPicker
                    owner={repo.repoOwner}
                    repo={repo.repoName}
                    onSelect={(branch) => {
                      setBranchPickerRepoId(null)
                      onCreateBranchFromGitBranch(repo.id, branch)
                    }}
                  />
                ) : null}
              </DialogContent>
            </Dialog>
          )
        })()}
        {(() => {
          const pending = pendingRemoveLayer
          const iframeLayer =
            pending?.kind === "iframe-layer"
              ? iframeLayersById.get(pending.id)
              : undefined
          const document =
            pending?.kind === "markdown-layer"
              ? documentsById.get(pending.id)
              : undefined
          const noun = pending?.kind === "markdown-layer" ? "document" : "frame"
          // An unnamed Layer reads "Delete frame?" rather than quoting nothing.
          const name = iframeLayer?.label ?? document?.title
          return (
            <ConfirmDialog
              open={!!(iframeLayer || document)}
              onOpenChange={(open) => {
                if (!open) setPendingRemoveLayer(null)
              }}
              verb="Delete"
              itemName={name}
              itemNoun={noun}
              description={`This ${noun} will be removed from the canvas for everyone. This cannot be undone.`}
              onConfirm={() => {
                if (iframeLayer) onRemoveIframeLayer(iframeLayer.id)
                if (document) onRemoveDocument(document.id)
                setPendingRemoveLayer(null)
              }}
            />
          )
        })()}
        {(() => {
          const group = pendingRemoveGroupId
            ? iframeLayerGroups.find((g) => g.id === pendingRemoveGroupId)
            : undefined
          const members = group ? getGroupMembers(group) : []
          const frames = members.filter((m) => m.kind === "iframe-layer").length
          const documents = members.filter(
            (m) => m.kind === "markdown-layer"
          ).length
          const contents = [
            frames > 0 && (frames === 1 ? "1 frame" : `${frames} frames`),
            documents > 0 &&
              (documents === 1 ? "1 document" : `${documents} documents`),
          ]
            .filter(Boolean)
            .join(" and ")
          return (
            <ConfirmDialog
              open={!!group}
              onOpenChange={(open) => {
                if (!open) setPendingRemoveGroupId(null)
              }}
              verb="Delete"
              itemName={group?.name}
              itemNoun="group"
              description={
                `This group${contents ? ` and its ${contents}` : ""} will be ` +
                "removed from the canvas for everyone. This cannot be undone."
              }
              onConfirm={() => {
                if (group) onRemoveIframeLayerGroup(group.id)
                setPendingRemoveGroupId(null)
              }}
            />
          )
        })()}
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

/** A Workspace row. Hovering it outlines the Workspace's frames (canvas and
 *  layer list); hovering one of those frames lights the row up (#793). */
function BranchRowShell({
  branchId,
  isPanelActive,
  children,
  ...rest
}: {
  branchId: string
  isPanelActive: boolean
  children: React.ReactNode
} & Pick<React.ComponentProps<"div">, "onClick" | "onDoubleClick">) {
  const isHighlighted = useIsWorkspaceHighlighted(branchId)
  const hover = { branchId, source: "workspace" } as const
  // A row unmounting mid-hover (deleted, collapsed) must not leave its
  // frames outlined.
  useEffect(
    () => () => workspaceHoverStore.clear({ branchId, source: "workspace" }),
    [branchId]
  )
  return (
    // The whole row opens the Workspace hover card (#882), so the card clears
    // the row's line count and menu instead of covering them.
    <WorkspaceHoverCard branchId={branchId}>
      <div
        {...rest}
        className={branchRowClassName({ isPanelActive, isHighlighted })}
        onPointerEnter={() => workspaceHoverStore.set(hover)}
        onPointerLeave={() => workspaceHoverStore.clear(hover)}
      >
        {children}
      </div>
    </WorkspaceHoverCard>
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
          <IconButton label="Workspace options" tooltipSide="right" asChild>
            <button
              className="flex size-5 items-center justify-center rounded-md text-sidebar-foreground/70 ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
              onClick={(e) => e.stopPropagation()}
            >
              <DotsThreeIcon className="size-4" />
            </button>
          </IconButton>
        </DropdownMenuTrigger>
        {menuContent}
      </DropdownMenu>
      {children}
    </span>
  )
}
