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

import {
  ArrowsDownUpIcon,
  CaretRightIcon,
  ChatCircleIcon,
  ChatsIcon,
  PencilSimpleIcon,
  TrashIcon,
  DotsThreeIcon,
  GitBranchIcon,
  PlusIcon,
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

import { BranchPicker } from "@/components/branch-picker"

import {
  CreateBranchDialog,
  NO_REPOSITORY_ID,
} from "@/components/create-branch-dialog"

import { ConfirmDialog } from "@/components/confirm-dialog"
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

import type { BranchPrInfo } from "@/lib/github-actions"

import { listRepoBranches } from "@/lib/github-actions"

import { isLocalBuild } from "@/lib/local-mode"

import { hasGitHubRemote, repoShortName } from "@/lib/repo-identity"

import { sortForSidebar } from "@/lib/sidebar-order"
import { defaultNewWorkspaceRepoId } from "@/lib/draw-ask"

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
  groupWorkspaces,
  type WorkspaceSort,
} from "@/lib/workspace-list-view"

import { useChatSessions } from "@/lib/yjs/react"
import { isSketchChat } from "@/lib/chat/sketch-chat"

/**
 * The chat panel's Chats menu (#1152, #1317): one button pinned to the far
 * right of the panel header that opens the list of every chat on the canvas.
 * It lists each Workspace's one chat (#1315) by its title and Workspace state
 * icon, never its branch, with what the sidebar used to hold (sort, grouping,
 * Done, row menus, drag). Documents have no chats of their own (#1314). It
 * opens from the Coordinator's header only, so it doesn't list the
 * Coordinator: a Workspace chat's Coordinator crumb goes back up.
 *
 * {@link ChatsMenuProvider} sits around the panel and owns everything
 * that outlives the menu (the dialogs its rows and actions open, the create
 * request from the getting-started checklist); {@link ChatsMenuButton}
 * renders the button in whichever header is showing. Without a provider (the
 * prototype player's chat) the button renders nothing.
 */

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
  /** Open a Workspace's chat; `expandPanel` defaults to true. */
  onSelectWorkspace: (id: string, options?: { expandPanel?: boolean }) => void
  /** Open a chat with no repository (a Sketch Chat). */
  onSelectSketchChat: (chatId: string) => void
  /**
   * Start a chat with no repository and open it, sending `prompt` as its
   * first message when there is one.
   */
  onCreateSketchChat: (spec?: { prompt?: string; model?: string }) => void
  /** Rename a chat with no repository. */
  onRenameSketchChat: (chatId: string, label: string) => void
  /** Delete a chat with no repository; what it made stays on the canvas. */
  onDeleteSketchChat: (chatId: string) => void
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
  askDeleteSketchChat: (chatId: string) => void
  /**
   * Rename asked for where the title can't be edited (a frame's Workspace
   * submenu): opens the Workspace's chat, whose header title takes it.
   */
  renameRequest: string | null
  requestRename: (branchId: string) => void
  clearRenameRequest: () => void
}

const ChatsMenuContext = createContext<ChatsMenuValue | null>(null)

/** The Chats menu's state and actions, or null outside its provider. */
export function useChatsMenu() {
  return useContext(ChatsMenuContext)
}

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
  const [pendingDeleteSketchId, setPendingDeleteSketchId] = useState<
    string | null
  >(null)
  const askDeleteSketchChat = useCallback((id: string) => {
    setOpen(false)
    setPendingDeleteSketchId(id)
  }, [])

  const [renameRequest, setRenameRequest] = useState<string | null>(null)
  const requestRename = useCallback(
    (id: string) => {
      setOpen(false)
      onSelectWorkspace(id)
      setRenameRequest(id)
    },
    [onSelectWorkspace]
  )
  const clearRenameRequest = useCallback(() => setRenameRequest(null), [])

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
    askDeleteSketchChat,
    renameRequest,
    requestRename,
    clearRenameRequest,
  }
  const deleteSketchChat = pendingDeleteSketchId
    ? sketchChats.find((c) => c.id === pendingDeleteSketchId)
    : undefined

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
      <ConfirmDialog
        open={!!deleteSketchChat}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteSketchId(null)
        }}
        verb="Delete"
        itemName={deleteSketchChat?.label ?? ""}
        itemNoun="chat"
        description="Its messages go. The mockups and documents it made stay on the canvas."
        onConfirm={() => {
          if (deleteSketchChat) props.onDeleteSketchChat(deleteSketchChat.id)
          setPendingDeleteSketchId(null)
        }}
      />
      <DeleteBranchDialog
        open={!!deleteBranch}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteBranchId(null)
        }}
        branchName={deleteBranch ? workspaceLabel(deleteBranch) : ""}
        // Remote deletion goes through the GitHub API, so it is only offered
        // when a token resolves and the Repository names a GitHub remote.
        canDeleteOnRemote={githubTokenAvailable && hasGitHubRemote(deleteRepo)}
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
        description="Renames the git branch. The chat keeps its title."
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
          Workspace menu's "New chat from here…" (#353). */}
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
 * panel's top level), with a dot on its icon while any Workspace needs you. A Workspace
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
          variant="outline"
          size="xs"
          aria-label="Chats"
          aria-description={menu.needsYou ? "A chat needs you" : undefined}
        >
          {/* The needs-you dot badges the icon's top-right corner, with a
              ring cut out of the icon so the two don't touch. */}
          <span data-icon="inline-start" className="relative flex">
            <ChatsIcon
              className={cn(
                "size-3",
                menu.needsYou &&
                  "[mask-image:radial-gradient(circle_at_10px_2px,transparent_4.5px,black_5px)]"
              )}
            />
            {menu.needsYou ? (
              <NeedsYouDot className="absolute -top-px -right-px size-1.5" />
            ) : null}
          </span>
          Chats
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
    sortedRepos,
    reposById,
    activeBranches,
    doneBranches,
    sketchChats,
    stateOf,
  } = menu
  const [search, setSearch] = useState("")
  const searching = search.trim() !== ""
  const [doneOpen, setDoneOpen] = useState(false)
  // This member's sort and grouping (#885), a local view preference.
  const [listView, updateListView] = useWorkspaceListView(userId, roomId)
  const sections = useMemo(
    () =>
      groupWorkspaces(activeBranches, listView.sort, (b) => stateOf(b).section),
    [activeBranches, listView.sort, stateOf]
  )

  const sketchRows = (list: ChatSessionData[]) =>
    list.map((chat) => (
      <SketchChatMenuRow key={chat.id} menu={menu} chat={chat} />
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
        />
      )
    })

  return (
    <Command
      // Filtering follows the search box; with it empty cmdk keeps our order.
      loop
      className="rounded-none!"
    >
      {/* + and … sit beside the search field, so they never depend on which
          section comes first and stay put while searching (H7). */}
      <div className="flex items-end gap-0.5 pr-1.5 *:data-[slot=command-input-wrapper]:flex-1">
        <CommandInput
          placeholder="Search chats…"
          value={search}
          onValueChange={setSearch}
        />
        <ChatsMenuActions
          menu={menu}
          sort={listView.sort}
          onSort={(sort) => updateListView({ sort })}
        />
      </div>
      <CommandList className="max-h-[min(28rem,var(--radix-popover-content-available-height))]">
        <CommandEmpty>
          {searching ? "No matches." : "No chats yet."}
        </CommandEmpty>

        {sortedRepos.length === 0 ? (
          // A canvas with no repository has chats with none, which write
          // Mockups and Documents.
          sketchChats.length > 0 && (
            <CommandGroup heading="Chats">
              {sketchRows(sketchChats)}
            </CommandGroup>
          )
        ) : searching ? (
          <CommandGroup heading="Chats">
            {rows([...activeBranches, ...doneBranches])}
            {sketchRows(sketchChats)}
          </CommandGroup>
        ) : (
          <>
            {/* Grouped by state (#885), each section under its own heading. */}
            {sections.map(({ section, branches }, i) => (
              <CommandGroup
                key={section}
                heading={WORKSPACE_SECTION_LABELS[section]}
                className={i > 0 ? "pt-0" : undefined}
              >
                {rows(branches)}
              </CommandGroup>
            ))}
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
 * The list's actions beside the search field: + starts a chat, and with it its
 * Workspace, in one step (#884, #1315); the … holds this member's view options
 * (#885) and the rarer Open existing git branch. On a canvas with no
 * repository + starts a chat with none, and there is nothing for … to hold.
 */
function ChatsMenuActions({
  menu,
  sort,
  onSort,
}: {
  menu: ChatsMenuValue
  sort: WorkspaceSort
  onSort: (sort: WorkspaceSort) => void
}) {
  const { sortedRepos } = menu
  if (sortedRepos.length === 0)
    return (
      <IconButton
        label="New chat"
        className="mb-0.5 text-muted-foreground"
        onClick={() => {
          menu.onCreateSketchChat()
          menu.setOpen(false)
        }}
      >
        <PlusIcon />
      </IconButton>
    )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="More chat actions"
            className="mb-0.5 text-muted-foreground"
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
        className="mb-0.5 text-muted-foreground"
        onClick={() => menu.openNewWorkspace(menu.lastUsedRepoId)}
      >
        <PlusIcon />
      </IconButton>
    </>
  )
}

/**
 * One chat with no repository in the menu: its title (renamed inline from its
 * … menu) and the … menu with Rename and Delete.
 */
function SketchChatMenuRow({
  menu,
  chat,
}: {
  menu: ChatsMenuValue
  chat: ChatSessionData
}) {
  const editableRef = useRef<EditableTextHandle | null>(null)
  const pendingEditRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  return (
    <CommandItem
      value={`${chat.label} ${chat.id}`}
      onSelect={() => {
        menu.onSelectSketchChat(chat.id)
        menu.setOpen(false)
      }}
      className="group/ws-row"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ChatCircleIcon className="size-3.5 opacity-70" />
      </span>
      <span
        className="flex min-w-0 flex-1 has-[[data-editable-text=editing]]:overflow-visible"
        onClick={(e) => {
          if (editableRef.current?.isEditing()) e.stopPropagation()
        }}
      >
        <EditableText
          ref={editableRef}
          as="span"
          value={chat.label}
          editTrigger="manual"
          onEditStart={() => setRenaming(true)}
          onEditEnd={() => setRenaming(false)}
          onCommit={(next) => {
            const label = next.trim()
            if (!label || label === chat.label) return
            menu.onRenameSketchChat(chat.id, label)
          }}
          className="min-w-0"
          viewClassName="truncate"
          editClassName={cn(
            editableTextFieldClass,
            "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
          )}
        />
      </span>
      {/* The … sits over the row's end, as on a Workspace row. */}
      <span
        {...isolate}
        className={cn(
          "absolute inset-y-0 right-0.5 flex items-center bg-(--row-bg) opacity-0 [--row-bg:var(--popover)] group-data-selected/ws-row:opacity-100 group-data-selected/ws-row:[--row-bg:var(--muted)] focus-within:opacity-100",
          menuOpen && "opacity-100",
          renaming && "invisible"
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-(--row-bg)" />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="Chat options"
              className="relative text-muted-foreground"
            >
              <DotsThreeIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            // Rename is a two-step: the menu closes, then the field takes
            // focus instead of the trigger.
            onCloseAutoFocus={(e) => {
              if (!pendingEditRef.current) return
              pendingEditRef.current = false
              e.preventDefault()
              editableRef.current?.startEditing()
            }}
          >
            <DropdownMenuItem
              onClick={() => {
                pendingEditRef.current = true
              }}
            >
              <PencilSimpleIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => menu.askDeleteSketchChat(chat.id)}
            >
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </CommandItem>
  )
}

/**
 * One Workspace's chat in the menu: its Workspace state icon, title (a chat
 * and its Workspace share one, #1315; renamed inline from its … menu), PR
 * badge or line count, and the … menu.
 * Hovering it outlines its frames on the canvas (#793) and opens its hover
 * card (#882), as the sidebar row did.
 */
function WorkspaceMenuRow({
  menu,
  branch,
  repo,
}: {
  menu: ChatsMenuValue
  branch: BranchData
  repo: RepoData
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
          other rows (#1165). It shows on hover, when the row is arrowed to,
          and while it holds focus; a fade in the row's colour runs under the
          meta it covers. */}
      <span
        {...isolate}
        className={cn(
          "absolute inset-y-0 right-0.5 flex items-center bg-(--row-bg) opacity-0 [--row-bg:var(--popover)] group-data-highlighted/ws-row:[--row-bg:var(--muted)] group-data-selected/ws-row:opacity-100 group-data-selected/ws-row:[--row-bg:var(--muted)] focus-within:opacity-100",
          menuOpen && "opacity-100",
          renaming && "invisible"
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-(--row-bg)" />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="Chat options"
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
  return withCard
}
