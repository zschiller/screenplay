"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react"

import { createPortal } from "react-dom"

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"

import {
  ArrowsDownUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChatCircleIcon,
  ChatsIcon,
  CheckIcon,
  DotsThreeIcon,
  GitBranchIcon,
  PlusIcon,
  RowsIcon,
} from "@workspace/ui/components/icons"

import { Button } from "@workspace/ui/components/button"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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

import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"

import { IconButton } from "@workspace/ui/components/icon-button"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import { cn } from "@workspace/ui/lib/utils"

import { AddRepositoryTrigger } from "@/components/add-repository-dialog"
import { BranchPicker } from "@/components/branch-picker"

import {
  CreateBranchDialog,
  NO_REPOSITORY_ID,
} from "@/components/create-branch-dialog"

import { DeleteBranchDialog } from "@/components/delete-branch-dialog"

import { InputDialog } from "@/components/home/input-dialog"

import { BranchOverflowMenuContent } from "@/components/panels/branch-overflow-menu"

import { useWorkspaceListView } from "@/components/panels/use-workspace-list-view"

import { WorkspaceStatusIcon } from "@/components/panels/workspace-status-icon"

import { RecreateBranchDialog } from "@/components/recreate-branch-dialog"

import { WorkspaceHoverCard } from "@/components/workspace-hover-card"
import { NeedsYouDot, WorkspaceMention } from "@/components/workspace-mention"

import type { DiffStats } from "@/hooks/use-diff-stats"

import { useGitHubTokenAvailable } from "@/hooks/use-github-token"

import { useUnsavedWork } from "@/hooks/use-unsaved-work"

import { useWorkspaceStates } from "@/hooks/use-workspace-states"

import type { ComposerSpec } from "@/lib/branch-create-planner"

import { checkBranchRename } from "@/lib/branch-rename"
import {
  anyWorkspaceNeedsYou,
  type WorkspaceState,
} from "@/lib/branch/workspace-state"

import { ROOM_CHAT_LABEL } from "@/lib/chat/room-chat"

import type { BranchPrInfo } from "@/lib/github-actions"

import { listRepoBranches } from "@/lib/github-actions"

import { isLocalBuild } from "@/lib/local-mode"

import { hasGitHubRemote, repoShortName } from "@/lib/repo-identity"

import { resolveRepoListDrop, type RepoListDropHint } from "@/lib/sidebar-drop"

import { sortForSidebar } from "@/lib/sidebar-order"
import { defaultNewWorkspaceRepoId } from "@/lib/frame-ask"

import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  MarkdownLayerData,
  RepoData,
} from "@/lib/types"

import {
  useIsWorkspaceHighlighted,
  workspaceHoverStore,
} from "@/lib/workspace-hover-store"

import { workspaceLabel } from "@/lib/workspace-label"

import {
  WORKSPACE_SECTION_LABELS,
  WORKSPACE_SORT_LABELS,
  canDragWorkspaces,
  groupWorkspaces,
  sortWorkspaces,
  type WorkspaceSort,
} from "@/lib/workspace-list-view"

import { useChatSessions } from "@/lib/yjs/react"
import { isSketchChat } from "@/lib/chat/sketch-chat"

/**
 * The chat panel's Chats menu (#1152, #1317): one button pinned to the far
 * right of the panel header that opens the list of every chat on the canvas.
 * The Coordinator leads it, then each Workspace's one chat (#1315) by its
 * title and Workspace state icon, never its branch, with what the sidebar used
 * to hold (sort, grouping, Done, row menus, drag). Documents have no chats of
 * their own (#1314). It is the one way to move between chats; the header's
 * breadcrumb only says where you are.
 *
 * {@link ChatsMenuProvider} sits around the panel and owns everything
 * that outlives the menu (the dialogs its rows and actions open, the create
 * request from the getting-started checklist); {@link ChatsMenuButton}
 * renders the button in whichever header is showing. Without a provider (the
 * prototype player's chat) the button renders nothing.
 */

/** Which chat the panel shows, for the menu's check marks. */
export type ChatsMenuCurrent =
  | { kind: "room" }
  | { kind: "agent"; id: string }
  | { kind: "sketch"; id: string }
  | { kind: "none" }

export interface ChatsMenuProviderProps {
  userId: string
  roomId: string
  repos: RepoData[]
  branches: BranchData[]
  markdownLayers: MarkdownLayerData[]
  iframeLayers: Array<Pick<IframeLayerData, "id" | "branchId">>
  diffStats: Map<string, DiffStats>
  /** GitHub-polled PR state per branch, shared with the chat header. */
  branchPrs: Map<string, BranchPrInfo>
  current: ChatsMenuCurrent
  onShowRoomChat: () => void
  /** Open a Workspace's chat; `expandPanel` defaults to true. */
  onSelectWorkspace: (id: string, options?: { expandPanel?: boolean }) => void
  /** Open a chat with no repository (a Sketch Chat). */
  onSelectSketchChat: (chatId: string) => void
  /**
   * Start a chat with no repository and open it, sending `prompt` as its
   * first message when there is one.
   */
  onCreateSketchChat: (spec?: { prompt?: string; model?: string }) => void
  onCreateBranchFromGitBranch: (repoId: string, branch: string) => void
  onCreateWorkspace: (repoId: string, specs: ComposerSpec[]) => void
  onRebaseOnDefault: (branchId: string) => void
  onRestartDevServer: (id: string) => void
  onCreatePr: (branchId: string) => void
  onRefreshBranch: (id: string) => void
  onRecreateBranch: (id: string) => void | Promise<void>
  onRetryBranch: (id: string) => void
  onMarkBranchDone: (id: string) => void
  onReopenBranch: (id: string) => void
  onRemoveBranch: (
    id: string,
    options: { deleteOnRemote: boolean }
  ) => void | Promise<void>
  onPlayBranch: (branchId: string) => void
  onShowRoutes: (branchId: string) => void
  onUpdateBranch: (id: string, data: Partial<BranchData>) => void
  onRenameBranch: (branchId: string, newBranch: string) => void
  /** Persist the room-shared order of one repo's Workspaces. */
  onReorderBranches: (repoId: string, orderedIds: string[]) => void
  children: React.ReactNode
}

type ChatsMenuValue = Omit<
  ChatsMenuProviderProps,
  "children" | "iframeLayers" | "onCreateWorkspace"
> & {
  open: boolean
  setOpen: (open: boolean) => void
  sortedRepos: RepoData[]
  reposById: Map<string, RepoData>
  /** Every Repo's Workspaces, Repo by Repo, in manual order, not Done. */
  activeBranches: BranchData[]
  /** Done Workspaces, most recently done first. */
  doneBranches: BranchData[]
  /** Chats with no repository, newest first. */
  sketchChats: ChatSessionData[]
  needsYou: boolean
  /** A Workspace's state: its icon, section and whether its agent works. */
  stateOf: (branch: BranchData) => WorkspaceState
  lastUsedRepoId: string | null
  /** Which Workspaces have a dialog open over them (no row hover then). */
  pendingBranchIds: Set<string>
  openNewWorkspace: (repoId: string | null, baseBranch?: string) => void
  openBranchPicker: (repoId: string) => void
  askDelete: (branchId: string) => void
  askRecreate: (branchId: string) => void
  askRenameBranch: (branchId: string) => void
}

const ChatsMenuContext = createContext<ChatsMenuValue | null>(null)

// Rows are cmdk items: its root handles arrow keys and Enter, and selects an
// item on click. A row's own controls (its … menu, which portals out while its
// React events still bubble here, and the inline rename) keep theirs.
const stop = (e: SyntheticEvent) => e.stopPropagation()
const isolate = {
  onClick: stop,
  onDoubleClick: stop,
  onKeyDown: stop,
  onPointerDown: stop,
}

export function ChatsMenuProvider({
  children,
  iframeLayers,
  onCreateWorkspace,
  ...props
}: ChatsMenuProviderProps) {
  const {
    repos,
    branches,
    markdownLayers,
    onSelectWorkspace,
    onCreateBranchFromGitBranch,
    onRecreateBranch,
    onRemoveBranch,
    onRenameBranch,
  } = props
  const [open, setOpen] = useState(false)
  const [branchPickerRepoId, setBranchPickerRepoId] = useState<string | null>(
    null
  )
  const [newWorkspaceRepoId, setNewWorkspaceRepoId] = useState<string | null>(
    null
  )
  // The base the create dialog seeds on when opened from "New workspace from
  // here…" (#353). Null for the plain + , which seeds on the Repo default.
  const [newWorkspaceBaseBranch, setNewWorkspaceBaseBranch] = useState<
    string | null
  >(null)
  const [pendingDeleteBranchId, setPendingDeleteBranchId] = useState<
    string | null
  >(null)
  const [pendingRecreateBranchId, setPendingRecreateBranchId] = useState<
    string | null
  >(null)
  const [pendingRenameBranchId, setPendingRenameBranchId] = useState<
    string | null
  >(null)

  // Per-repo remote branch names, fetched once per repo, so Rename branch
  // can refuse a name that's taken instead of failing in `git branch -m`.
  const [remoteBranchesByRepo, setRemoteBranchesByRepo] = useState<
    Map<string, Set<string>>
  >(new Map())
  useEffect(() => {
    let cancelled = false
    for (const repo of repos) {
      if (remoteBranchesByRepo.has(repo.id)) continue
      listRepoBranches(repo.repoOwner, repo.repoName).then((data) => {
        if (cancelled) return
        setRemoteBranchesByRepo((prev) => {
          if (prev.has(repo.id)) return prev
          const next = new Map(prev)
          next.set(repo.id, new Set(data.map((b) => b.name)))
          return next
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [repos, remoteBranchesByRepo])

  // Whether the GitHub API is reachable at all, for the delete dialog's
  // remote-branch offer (issue #741). False until probed.
  const githubTokenAvailable = useGitHubTokenAvailable()
  // What the delete confirm says is lost (issue #776): the Chat Sessions and
  // frames the Workspace cascades to, and its checkout's unpushed work.
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

  // Repos in their manual order, else by full name; each Repo's Workspaces
  // in theirs, else by creation. The list flattens them Repo by Repo (#884).
  const sortedRepos = useMemo(
    () =>
      sortForSidebar(repos, (a, b) =>
        a.repoFullName.localeCompare(b.repoFullName)
      ),
    [repos]
  )
  const reposById = useMemo(
    () => new Map(sortedRepos.map((r) => [r.id, r])),
    [sortedRepos]
  )
  const flatBranches = useMemo(
    () =>
      sortedRepos.flatMap((r) =>
        sortForSidebar(
          branches.filter((b) => b.repoId === r.id),
          (a, b) => a.createdAt - b.createdAt
        )
      ),
    [sortedRepos, branches]
  )
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
  const stateOf = useWorkspaceStates()
  const needsYou = useMemo(
    () => anyWorkspaceNeedsYou(flatBranches, stateOf),
    [flatBranches, stateOf]
  )
  // New workspace starts in the Repo used last: the newest Workspace's.
  const lastUsedRepoId = useMemo(
    () => defaultNewWorkspaceRepoId(repos, branches),
    [repos, branches]
  )

  // Open a Workspace when it finishes setting up. The callback is read through
  // a ref so this runs on `branches` changes only.
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const onSelectWorkspaceRef = useRef(onSelectWorkspace)
  useEffect(() => {
    onSelectWorkspaceRef.current = onSelectWorkspace
  })
  useEffect(() => {
    const prev = prevStatusRef.current
    for (const branch of branches) {
      const was = prev.get(branch.id)
      if (
        (was === "creating" || was === "starting") &&
        branch.status === "running"
      ) {
        onSelectWorkspaceRef.current(branch.id)
      }
    }
    prevStatusRef.current = new Map(branches.map((b) => [b.id, b.status]))
  }, [branches])

  const pendingBranchIds = useMemo(
    () =>
      new Set(
        [
          pendingDeleteBranchId,
          pendingRecreateBranchId,
          pendingRenameBranchId,
        ].filter((id): id is string => !!id)
      ),
    [pendingDeleteBranchId, pendingRecreateBranchId, pendingRenameBranchId]
  )

  // A dialog opened from the menu takes over from it.
  const openNewWorkspace = useCallback(
    (repoId: string | null, baseBranch?: string) => {
      setOpen(false)
      setNewWorkspaceBaseBranch(baseBranch ?? null)
      setNewWorkspaceRepoId(repoId)
    },
    []
  )
  const openBranchPicker = useCallback((repoId: string) => {
    setOpen(false)
    setBranchPickerRepoId(repoId)
  }, [])
  const askDelete = useCallback((id: string) => {
    setOpen(false)
    setPendingDeleteBranchId(id)
  }, [])
  const askRecreate = useCallback((id: string) => {
    setOpen(false)
    setPendingRecreateBranchId(id)
  }, [])
  const askRenameBranch = useCallback((id: string) => {
    setOpen(false)
    setPendingRenameBranchId(id)
  }, [])

  const sketchChats = useMemo(
    () =>
      chatSessions
        .filter(isSketchChat)
        .sort((a, b) => b.createdAt - a.createdAt),
    [chatSessions]
  )

  const value: ChatsMenuValue = {
    ...props,
    open,
    setOpen,
    sortedRepos,
    reposById,
    activeBranches,
    doneBranches,
    sketchChats,
    needsYou,
    stateOf,
    lastUsedRepoId,
    pendingBranchIds,
    openNewWorkspace,
    openBranchPicker,
    askDelete,
    askRecreate,
    askRenameBranch,
  }

  const deleteBranch = pendingDeleteBranchId
    ? branches.find((b) => b.id === pendingDeleteBranchId)
    : null
  const deleteRepo = deleteBranch
    ? repos.find((r) => r.id === deleteBranch.repoId)
    : undefined
  const renameBranch = pendingRenameBranchId
    ? branches.find((b) => b.id === pendingRenameBranchId)
    : null
  const recreateBranch = pendingRecreateBranchId
    ? branches.find((b) => b.id === pendingRecreateBranchId)
    : null
  const pickerRepo = branchPickerRepoId
    ? reposById.get(branchPickerRepoId)
    : undefined

  return (
    <ChatsMenuContext.Provider value={value}>
      {children}
      <DeleteBranchDialog
        open={!!deleteBranch}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteBranchId(null)
        }}
        branchName={deleteBranch ? workspaceLabel(deleteBranch) : ""}
        // Remote deletion goes through the GitHub API, so it is only offered
        // when a token resolves and the Repository names a GitHub remote.
        canDeleteOnRemote={githubTokenAvailable && hasGitHubRemote(deleteRepo)}
        chatCount={
          deleteBranch
            ? chatSessions.filter((c) => c.branchId === deleteBranch.id).length
            : 0
        }
        frameCount={
          deleteBranch
            ? iframeLayers.filter((l) => l.branchId === deleteBranch.id).length
            : 0
        }
        openPrNumber={
          deleteBranch?.prState === "open" ? deleteBranch.prNumber : undefined
        }
        work={deleteBranch ? unsavedWork.get(deleteBranch.id) : undefined}
        localBranchKept={isLocalBuild}
        onConfirm={async ({ deleteOnRemote }) => {
          if (!deleteBranch) return
          await onRemoveBranch(deleteBranch.id, { deleteOnRemote })
          setPendingDeleteBranchId(null)
        }}
      />
      <InputDialog
        open={!!renameBranch}
        onOpenChange={(next) => {
          if (!next) setPendingRenameBranchId(null)
        }}
        title="Rename branch"
        description="Renames the git branch. The workspace keeps its title."
        initialValue={renameBranch?.ref ?? ""}
        submitLabel="Rename"
        submittingLabel="Renaming…"
        errorMessage="That branch name is empty or already taken."
        onSubmit={async (next) => {
          if (!renameBranch) return
          const check = checkBranchRename({
            next,
            current: renameBranch.ref,
            remoteBranches: remoteBranchesByRepo.get(renameBranch.repoId),
            otherLocalRefs: isLocalBuild
              ? branches
                  .filter(
                    (b) =>
                      b.repoId === renameBranch.repoId &&
                      b.id !== renameBranch.id
                  )
                  .map((b) => b.ref)
              : [],
          })
          if (check.kind === "invalid") throw new Error("Invalid branch name")
          if (check.kind === "rename")
            onRenameBranch(renameBranch.id, check.branch)
        }}
      />
      <RecreateBranchDialog
        open={!!recreateBranch}
        onOpenChange={(next) => {
          if (!next) setPendingRecreateBranchId(null)
        }}
        branchName={recreateBranch?.ref ?? ""}
        workspaceTitle={
          recreateBranch ? workspaceLabel(recreateBranch) : undefined
        }
        onConfirm={async () => {
          if (!recreateBranch) return
          // The confirm stays open ("Recreating…") until this settles; a
          // failure rejects and shows inline for a retry.
          await onRecreateBranch(recreateBranch.id)
          setPendingRecreateBranchId(null)
        }}
      />
      {newWorkspaceRepoId && reposById.has(newWorkspaceRepoId) ? (
        <CreateBranchDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) {
              setNewWorkspaceRepoId(null)
              setNewWorkspaceBaseBranch(null)
            }
          }}
          repos={sortedRepos}
          repoId={newWorkspaceRepoId}
          baseBranch={newWorkspaceBaseBranch ?? undefined}
          markdownLayers={markdownLayers}
          onSubmit={(specs) => {
            // A row with no repository starts a chat with none.
            for (const spec of specs) {
              if (spec.repoId !== NO_REPOSITORY_ID) continue
              props.onCreateSketchChat({
                prompt: spec.prompt,
                model: spec.model,
              })
            }
            const withRepo = specs.filter((s) => s.repoId !== NO_REPOSITORY_ID)
            // One create per Repo, each keeping its rows' order.
            for (const repoId of new Set(withRepo.map((s) => s.repoId))) {
              onCreateWorkspace(
                repoId,
                withRepo
                  .filter((s) => s.repoId === repoId)
                  .map(({ repoId: _, ...spec }) => spec)
              )
            }
          }}
        />
      ) : null}
      {/* "Open existing git branch" reattaches to a remote branch: a single
          Enter action, no new branch and no prompt. Forking lives in the
          Workspace menu's "New workspace from here…" (#353). */}
      <Dialog
        open={!!pickerRepo}
        onOpenChange={(next) => {
          if (!next) setBranchPickerRepoId(null)
        }}
      >
        <DialogContent className="max-w-sm gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-2">
            <DialogTitle>Open existing git branch</DialogTitle>
          </DialogHeader>
          {pickerRepo ? (
            <BranchPicker
              owner={pickerRepo.repoOwner}
              repo={pickerRepo.repoName}
              onSelect={(branch) => {
                setBranchPickerRepoId(null)
                onCreateBranchFromGitBranch(pickerRepo.id, branch)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </ChatsMenuContext.Provider>
  )
}

/**
 * The labelled Chats button at the right of the Coordinator header (the
 * panel's top level), with a dot while any Workspace needs you. A Workspace
 * chat has no button: its Coordinator crumb goes back up. Renders nothing
 * outside a provider.
 */
export function ChatsMenuButton() {
  const menu = useContext(ChatsMenuContext)
  if (!menu) return null
  return (
    <Popover open={menu.open} onOpenChange={menu.setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label="Chats"
          aria-description={menu.needsYou ? "A chat needs you" : undefined}
          className="text-muted-foreground"
        >
          Chats
          {menu.needsYou ? <NeedsYouDot className="size-1.5" /> : null}
          <CaretDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-chats-menu=""
        side="bottom"
        align="end"
        className="w-80 p-0"
        collisionPadding={8}
        // Escape in a rename field cancels the rename and leaves the menu open.
        onEscapeKeyDown={(e) => {
          if ((e.target as HTMLElement | null)?.isContentEditable)
            e.preventDefault()
        }}
      >
        <ChatsMenuList menu={menu} />
      </PopoverContent>
    </Popover>
  )
}

function ChatsMenuList({ menu }: { menu: ChatsMenuValue }) {
  const {
    userId,
    roomId,
    current,
    sortedRepos,
    reposById,
    activeBranches,
    doneBranches,
    sketchChats,
    stateOf,
    setOpen,
  } = menu
  const [search, setSearch] = useState("")
  const searching = search.trim() !== ""
  const [doneOpen, setDoneOpen] = useState(false)
  // This member's sort and grouping (#885), a local view preference.
  const [listView, updateListView] = useWorkspaceListView(userId, roomId)
  const listedBranches = useMemo(
    () => sortWorkspaces(activeBranches, listView.sort),
    [activeBranches, listView.sort]
  )
  const sections = useMemo(
    () =>
      listView.groupByState
        ? groupWorkspaces(
            activeBranches,
            listView.sort,
            (b) => stateOf(b).section
          )
        : null,
    [activeBranches, listView, stateOf]
  )
  // Drag writes manual order, so it only runs where rows show it, and not
  // over a filtered list.
  const canDrag = canDragWorkspaces(listView) && !searching

  const pick = (select: () => void) => {
    select()
    setOpen(false)
  }

  const sketchRows = (list: ChatSessionData[]) =>
    list.map((chat) => (
      <CommandItem
        key={chat.id}
        value={`${chat.label} ${chat.id}`}
        onSelect={() => pick(() => menu.onSelectSketchChat(chat.id))}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ChatCircleIcon className="size-3.5 opacity-70" />
        </span>
        <span className="truncate">{chat.label}</span>
        <CheckIcon
          className={cn(
            "ml-auto size-3.5",
            !(current.kind === "sketch" && current.id === chat.id) &&
              "opacity-0"
          )}
        />
      </CommandItem>
    ))

  const rows = (list: BranchData[]) =>
    list.map((branch) => {
      const repo = reposById.get(branch.repoId)
      if (!repo) return null
      return (
        <WorkspaceMenuRow
          key={branch.id}
          menu={menu}
          branch={branch}
          repo={repo}
          sortable={canDrag && !branch.doneAt}
        />
      )
    })

  return (
    <Command
      // Filtering follows the search box; with it empty cmdk keeps our order.
      loop
      className="rounded-none!"
    >
      <CommandInput
        placeholder="Search chats…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[min(28rem,var(--radix-popover-content-available-height))]">
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup>
          <CommandItem
            value={ROOM_CHAT_LABEL}
            onSelect={() => pick(menu.onShowRoomChat)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <ChatsIcon className="size-3.5 opacity-70" />
            </span>
            <span className="truncate">{ROOM_CHAT_LABEL}</span>
            <CheckIcon
              className={cn(
                "ml-auto size-3.5",
                current.kind !== "room" && "opacity-0"
              )}
            />
          </CommandItem>
        </CommandGroup>

        {sortedRepos.length === 0 ? (
          // A canvas with no repository has chats with none, which write
          // Mockups and Documents; code needs a repository, added straight
          // from the picker (#1182).
          <>
            <CommandGroup heading="Chats">
              {sketchRows(sketchChats)}
              <CommandItem
                value="New chat"
                onSelect={() => pick(() => menu.onCreateSketchChat())}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <PlusIcon className="size-3.5 opacity-70" />
                </span>
                New chat
              </CommandItem>
            </CommandGroup>
            {!searching && (
              <div className="flex flex-col items-center gap-3 border-t px-4 py-4">
                <p className="text-center text-xs text-balance text-muted-foreground">
                  Add a repository to change code and preview it in frames.
                </p>
                <AddRepositoryTrigger
                  align="center"
                  onPick={() => setOpen(false)}
                >
                  <Button type="button" variant="outline" size="sm">
                    Add repository
                  </Button>
                </AddRepositoryTrigger>
              </div>
            )}
          </>
        ) : searching ? (
          <CommandGroup heading="Chats">
            {rows([...activeBranches, ...doneBranches])}
            {sketchRows(sketchChats)}
          </CommandGroup>
        ) : (
          <>
            {/* Grouped by state (#885), each section is its own label, and
                the first one takes this label's place beside the actions. */}
            <WorkspacesLabel
              menu={menu}
              label={
                sections?.[0]
                  ? WORKSPACE_SECTION_LABELS[sections[0].section]
                  : "Chats"
              }
              sort={listView.sort}
              groupByState={listView.groupByState}
              onSort={(sort) => updateListView({ sort })}
              onGroupByState={(groupByState) =>
                updateListView({ groupByState })
              }
            />
            {sections ? (
              sections.map(({ section, branches }, i) => (
                <CommandGroup
                  key={section}
                  heading={
                    i > 0 ? WORKSPACE_SECTION_LABELS[section] : undefined
                  }
                  className="pt-0"
                >
                  {rows(branches)}
                </CommandGroup>
              ))
            ) : canDrag ? (
              <SortableWorkspaces menu={menu} branches={listedBranches}>
                {rows(listedBranches)}
              </SortableWorkspaces>
            ) : (
              <CommandGroup className="pt-0">
                {rows(listedBranches)}
              </CommandGroup>
            )}
            {sketchChats.length > 0 && (
              <CommandGroup heading="No repository">
                {sketchRows(sketchChats)}
              </CommandGroup>
            )}
            {doneBranches.length > 0 && (
              <CommandGroup className="pt-0">
                <CommandItem
                  value="Done"
                  aria-expanded={doneOpen}
                  onSelect={() => setDoneOpen((v) => !v)}
                  className="text-muted-foreground"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <CaretRightIcon
                      className={cn(
                        "size-3.5 transition-transform",
                        doneOpen && "rotate-90"
                      )}
                    />
                  </span>
                  Done ({doneBranches.length})
                </CommandItem>
                {doneOpen && rows(doneBranches)}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </Command>
  )
}

/**
 * The Chats label with the list's actions: + starts a chat, and with it its
 * Workspace, in one step (#884, #1315); the … beside it holds this member's view options (#885) and the
 * rarer Open existing git branch. Styled like a cmdk group heading, but a
 * plain row, since cmdk hides its headings from assistive technology.
 */
function WorkspacesLabel({
  menu,
  label,
  sort,
  groupByState,
  onSort,
  onGroupByState,
}: {
  menu: ChatsMenuValue
  label: string
  sort: WorkspaceSort
  groupByState: boolean
  onSort: (sort: WorkspaceSort) => void
  onGroupByState: (groupByState: boolean) => void
}) {
  const { sortedRepos } = menu
  return (
    <div className="flex items-center gap-0.5 px-1 pt-1">
      <span className="flex-1 px-2 py-1.5 font-mono text-xs tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="More chat actions"
            className="text-muted-foreground"
          >
            <DotsThreeIcon />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" {...isolate}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowsDownUpIcon />
              Sort by
              <span className="flex-1 text-right text-muted-foreground">
                {WORKSPACE_SORT_LABELS[sort]}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => onSort(v as WorkspaceSort)}
              >
                {(Object.keys(WORKSPACE_SORT_LABELS) as WorkspaceSort[]).map(
                  (s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {WORKSPACE_SORT_LABELS[s]}
                    </DropdownMenuRadioItem>
                  )
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            checked={groupByState}
            onCheckedChange={(checked) => onGroupByState(checked === true)}
          >
            <RowsIcon />
            Group by state
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {sortedRepos.length === 1 ? (
            <DropdownMenuItem
              onClick={() => menu.openBranchPicker(sortedRepos[0]!.id)}
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
                    onClick={() => menu.openBranchPicker(repo.id)}
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
        label="New chat"
        className="mr-1 text-muted-foreground"
        onClick={() => menu.openNewWorkspace(menu.lastUsedRepoId)}
      >
        <PlusIcon />
      </IconButton>
    </div>
  )
}

/**
 * One Workspace's chat in the menu: its Workspace state icon, title (a chat
 * and its Workspace share one, #1315; renamed inline from its … menu), PR
 * badge or line count, the … menu, and a check on the open one.
 * Hovering it outlines its frames on the canvas (#793) and opens its hover
 * card (#882), as the sidebar row did.
 */
function WorkspaceMenuRow({
  menu,
  branch,
  repo,
  sortable,
}: {
  menu: ChatsMenuValue
  branch: BranchData
  repo: RepoData
  sortable: boolean
}) {
  const editableRef = useRef<EditableTextHandle | null>(null)
  const pendingEditRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const isHighlighted = useIsWorkspaceHighlighted(branch.id)
  const hover = { branchId: branch.id, source: "workspace" } as const
  // A row unmounting mid-hover (the menu closing) must not leave its frames
  // outlined.
  useEffect(
    () => () =>
      workspaceHoverStore.clear({ branchId: branch.id, source: "workspace" }),
    [branch.id]
  )
  const state = menu.stateOf(branch)
  const pr = menu.branchPrs.get(branch.id)
  const stats = menu.diffStats.get(branch.id)
  const hasStats = !!stats && (stats.additions > 0 || stats.deletions > 0)
  const isCurrent =
    menu.current.kind === "agent" && menu.current.id === branch.id
  const label = workspaceLabel(branch)
  const showRepoNames = menu.sortedRepos.length > 1

  const item = (
    <CommandItem
      value={`${label} ${branch.ref ?? ""} ${branch.id}`}
      keywords={[label, branch.ref ?? "", repoShortName(repo)]}
      onSelect={() => {
        menu.onSelectWorkspace(branch.id, { expandPanel: false })
        menu.setOpen(false)
      }}
      onPointerEnter={() => workspaceHoverStore.set(hover)}
      onPointerLeave={() => workspaceHoverStore.clear(hover)}
      data-highlighted={isHighlighted || undefined}
      className="group/ws-row data-highlighted:bg-muted"
    >
      <WorkspaceMention
        branch={branch}
        prOverride={pr ?? null}
        fallback={
          hasStats ? (
            <span className="flex items-center gap-1 font-mono text-xs">
              <span className="text-success">+{stats.additions}</span>
              <span className="text-destructive">-{stats.deletions}</span>
            </span>
          ) : null
        }
        icon={
          <WorkspaceStatusIcon
            line={state.line}
            onRetry={() => menu.onRetryBranch(branch.id)}
            onRecreate={() => menu.askRecreate(branch.id)}
          />
        }
        name={
          branch.ref ? (
            <span
              className="flex max-w-full min-w-0 has-[[data-editable-text=editing]]:overflow-visible"
              onClick={(e) => {
                if (editableRef.current?.isEditing()) e.stopPropagation()
              }}
            >
              <EditableText
                ref={editableRef}
                as="span"
                value={label}
                editTrigger="manual"
                onEditStart={() => setRenaming(true)}
                onEditEnd={() => setRenaming(false)}
                onCommit={(next) => {
                  // Renames the title only (#881); the branch moves through
                  // Rename branch in the menu.
                  const title = next.trim()
                  if (!title || title === label) return
                  menu.onUpdateBranch(branch.id, { title })
                }}
                className="min-w-0"
                viewClassName="truncate"
                editClassName={cn(
                  editableTextFieldClass,
                  "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
                )}
              />
            </span>
          ) : (
            <span className="truncate font-mono text-xs text-muted-foreground">
              Creating…
            </span>
          )
        }
      />
      {showRepoNames && (
        <span className="shrink-0 truncate text-xs text-muted-foreground">
          {repoShortName(repo)}
        </span>
      )}
      {/* The … sits over the row's end, like a chat tab's close button, so
          it holds no slot at rest and the row stays as tall as the
          Coordinator row (#1165). It shows on hover, when the
          row is arrowed to, and while it holds focus; a fade in the row's
          colour runs under the meta it covers. right-7.5 clears the check
          column (px-2 + gap-2 + the 14px check). */}
      <span
        {...isolate}
        className={cn(
          "absolute inset-y-0 right-7.5 flex items-center bg-(--row-bg) opacity-0 [--row-bg:var(--popover)] group-data-highlighted/ws-row:[--row-bg:var(--muted)] group-data-selected/ws-row:opacity-100 group-data-selected/ws-row:[--row-bg:var(--muted)] focus-within:opacity-100",
          menuOpen && "opacity-100",
          renaming && "invisible"
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-(--row-bg)" />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="Workspace options"
              className="relative text-muted-foreground"
            >
              <DotsThreeIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <BranchOverflowMenuContent
            branch={branch}
            repo={repo}
            onPlay={menu.onPlayBranch}
            onRetry={menu.onRetryBranch}
            hasChanges={hasStats}
            onRename={() => {
              pendingEditRef.current = true
            }}
            onRenameBranch={menu.askRenameBranch}
            onNewBranchFromHere={() =>
              menu.openNewWorkspace(branch.repoId, branch.ref ?? undefined)
            }
            onRestartDevServer={menu.onRestartDevServer}
            onRestart={menu.onRefreshBranch}
            onRecreate={menu.askRecreate}
            onShowRoutes={(id) => {
              menu.setOpen(false)
              menu.onShowRoutes(id)
            }}
            onCreatePr={menu.onCreatePr}
            pr={pr}
            onRebase={menu.onRebaseOnDefault}
            onMarkDone={menu.onMarkBranchDone}
            onReopen={menu.onReopenBranch}
            onDelete={menu.askDelete}
            // Rename is a two-step: the menu closes, then the field takes
            // focus instead of the trigger.
            onCloseAutoFocus={(e) => {
              if (!pendingEditRef.current) return
              pendingEditRef.current = false
              e.preventDefault()
              editableRef.current?.startEditing()
            }}
            isBusy={state.agentWorking}
          />
        </DropdownMenu>
      </span>
      <CheckIcon className={cn("size-3.5", !isCurrent && "opacity-0")} />
    </CommandItem>
  )

  // The row's hover card (#882) says its state in words and names its branch;
  // it opens beside the menu, and stays shut while the row's menu or a
  // dialog it opened is up.
  const withCard = (
    <WorkspaceHoverCard
      branchId={branch.id}
      side="left"
      align="start"
      suppressed={renaming || menu.pendingBranchIds.has(branch.id)}
    >
      {item}
    </WorkspaceHoverCard>
  )
  if (!sortable) return withCard
  return (
    <SortableWorkspace id={`branch:${branch.id}`} repoId={repo.id}>
      {withCard}
    </SortableWorkspace>
  )
}

// --- Drag to reorder: ungrouped Manual sort only, within a Repo's run ---

type LineHint = RepoListDropHint | null

const DropHintContext = createContext<LineHint>(null)

type DragData = { kind?: string; repoId?: string }

/** Is droppable `target` a legal landing spot for the dragged Workspace? */
function sameRepo(active?: DragData, target?: DragData): boolean {
  return (
    active?.kind === "branch" &&
    target?.kind === "branch" &&
    target.repoId === active.repoId
  )
}

/**
 * Pointer-driven collision: the row under the pointer, else the nearest one,
 * among the dragged Workspace's own Repo only. Over another Repo's rows there
 * is no target at all rather than a misleading line.
 */
const workspacesCollision: CollisionDetection = (args) => {
  const active = args.active.data.current as DragData | undefined
  const dataOf = (id: string | number) =>
    args.droppableContainers.find((c) => c.id === id)?.data.current as
      DragData | undefined
  const within = pointerWithin(args).filter((c) =>
    sameRepo(active, dataOf(c.id))
  )
  if (within.length > 0) return within
  const y = args.pointerCoordinates?.y
  if (y == null) return []
  let best: { id: string | number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const container of args.droppableContainers) {
    if (!sameRepo(active, container.data.current as DragData | undefined))
      continue
    const rect = args.droppableRects.get(container.id)
    if (!rect) continue
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
    const dist =
      y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    if (dist < bestDist) {
      bestDist = dist
      best = { id: container.id }
    }
  }
  if (!best || y < top || y > bottom) return []
  return [best]
}

function SortableWorkspaces({
  menu,
  branches,
  children,
}: {
  menu: ChatsMenuValue
  branches: BranchData[]
  children: React.ReactNode
}) {
  const sensors = useSensors(
    // Clicks (no movement) still pick the row; a drag past 6px moves it.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const [dragging, setDragging] = useState<BranchData | null>(null)
  const [hint, setHint] = useState<LineHint>(null)
  // dnd-kit's move events don't carry the pointer; track it while dragging.
  const pointerYRef = useRef(0)
  const onPointerMove = useCallback((e: PointerEvent) => {
    pointerYRef.current = e.clientY
  }, [])
  const dropRepos = useMemo(
    () =>
      menu.sortedRepos.map((r) => ({
        id: r.id,
        branchIds: menu.activeBranches
          .filter((b) => b.repoId === r.id)
          .map((b) => b.id),
      })),
    [menu.sortedRepos, menu.activeBranches]
  )
  const resolve = (
    activeId: string,
    over: { id: string | number; rect: ClientRect }
  ) =>
    resolveRepoListDrop({
      repos: dropRepos,
      activeId,
      overId: String(over.id),
      side:
        pointerYRef.current < over.rect.top + over.rect.height / 2
          ? "before"
          : "after",
    })
  const end = () => {
    window.removeEventListener("pointermove", onPointerMove)
    setDragging(null)
    setHint(null)
  }
  return (
    <DndContext
      // Stable id keeps dnd-kit's a11y ids deterministic across hydration.
      id="workspaces-menu"
      sensors={sensors}
      collisionDetection={workspacesCollision}
      onDragStart={(event: DragStartEvent) => {
        const id = String(event.active.id)
        setDragging(branches.find((b) => `branch:${b.id}` === id) ?? null)
        const ae = event.activatorEvent as { clientY?: number }
        if (typeof ae.clientY === "number") pointerYRef.current = ae.clientY
        window.addEventListener("pointermove", onPointerMove)
      }}
      onDragMove={(event: DragMoveEvent) => {
        const next = event.over
          ? resolve(String(event.active.id), event.over).hint
          : null
        setHint((prev) =>
          prev?.rowId === next?.rowId && prev?.edge === next?.edge ? prev : next
        )
      }}
      onDragEnd={(event: DragEndEvent) => {
        const intent = event.over
          ? resolve(String(event.active.id), event.over).intent
          : null
        end()
        if (intent?.kind === "reorder-branches")
          menu.onReorderBranches(intent.repoId, intent.orderedIds)
      }}
      onDragCancel={end}
    >
      <DropHintContext.Provider value={hint}>
        <CommandGroup className="pt-0">
          <SortableContext
            items={branches.map((b) => `branch:${b.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {children}
          </SortableContext>
        </CommandGroup>
      </DropHintContext.Provider>
      {/* The popover is positioned with a transform, which would offset a
          fixed overlay inside it; draw the preview from the body instead. */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay dropAnimation={null}>
            {dragging ? (
              <div className="flex items-center gap-2 rounded-sm bg-popover px-2 py-1.5 text-sm text-popover-foreground shadow-lg ring-1 ring-border">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <GitBranchIcon className="size-3.5 opacity-70" />
                </span>
                <span className="truncate">{workspaceLabel(dragging)}</span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  )
}

/**
 * A draggable Workspace row. The source goes transparent while the overlay
 * follows the pointer, and a line marks where it lands. Only the pointer
 * drags: cmdk owns the arrow keys.
 */
function SortableWorkspace({
  id,
  repoId,
  children,
}: {
  id: string
  repoId: string
  children: React.ReactNode
}) {
  const { listeners, setNodeRef, isDragging } = useSortable({
    id,
    data: { kind: "branch", repoId },
  })
  const hint = useContext(DropHintContext)
  const edge = hint && hint.rowId === id ? hint.edge : null
  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0 : undefined }}
      className="relative"
      {...listeners}
    >
      {children}
      {edge ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-canvas-selection"
          style={edge === "before" ? { top: -1 } : { bottom: -1 }}
        />
      ) : null}
    </div>
  )
}
