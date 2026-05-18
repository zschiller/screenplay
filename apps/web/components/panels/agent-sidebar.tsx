"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Reorder } from "motion/react"
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
  Trash2,
  MoreHorizontal,
  Pencil,
  Play,
  Route,
  PanelLeftClose,
  Terminal,
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
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
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
  onRouteChange: (id: string, route: string) => void
  onRemoveIframeLayer: (id: string) => void
  onSelectDocument: (id: string, shiftKey: boolean) => void
  onZoomToDocument: (id: string) => void
  onRenameDocument: (id: string, title: string) => void
  onRemoveDocument: (id: string) => void
  onReorderIframeLayerGroups: (orderedIds: string[]) => void
  onReorderGroupMembers: (groupId: string, orderedMembers: GroupMember[]) => void
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
  onRouteChange,
  onRemoveIframeLayer,
  onSelectDocument,
  onZoomToDocument,
  onRenameDocument,
  onRemoveDocument,
  onReorderIframeLayerGroups,
  onReorderGroupMembers,
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
    onChangeRoute?: (id: string, route: string) => void
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
      onChangeRoute: onRouteChange,
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
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
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
                                <Folder className="block group-hover/workspace-row:hidden text-sidebar-foreground/70" />
                                <ChevronRight className="hidden group-hover/workspace-row:block cursor-pointer text-sidebar-foreground/70 transition-transform group-data-[state=open]/collapsible:rotate-90" />
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
                          <SidebarMenu>
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
                                    <>
                                        <div
                                          className={`group/agent-row grid grid-cols-[1fr_auto] items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground${isPanelActive ? " bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
                                          onClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id, { expandPanel: false }) }}
                                          onDoubleClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id) }}
                                        >
                                          <SidebarMenuButton
                                            className="!pr-0 !bg-transparent hover:!bg-transparent"
                                            isActive={false}
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
                                              <BranchBadge branch={agent.branch} colorKey={agent.id} className="text-[11px] py-0 px-1.5" />
                                            ) : (
                                              <span className="truncate font-mono text-xs text-muted-foreground">creating...</span>
                                            )}
                                          </SidebarMenuButton>
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
                                                  {agent.previewDomain ? (
                                                    <button
                                                      className="hidden h-5 w-5 items-center justify-center rounded-md text-sidebar-foreground/70 ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-hover/agent-row:flex group-focus-within/agent-row:flex md:group-has-data-[menu-visible]/slot:flex"
                                                      onClick={(e) => { e.stopPropagation(); onPlayAgent(agent.id) }}
                                                      title="Open prototype player"
                                                    >
                                                      <Play className="size-3.5" />
                                                    </button>
                                                  ) : null}
                                                  <AgentDropdownSlot
                                                    menuContent={
                                                      <DropdownMenuContent side="right" align="start" className="w-48">
                                                        <DropdownMenuItem
                                                          disabled={!agent.previewDomain}
                                                          onClick={() => onPlayAgent(agent.id)}
                                                        >
                                                          <Play />
                                                          Open prototype player
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem onClick={() => {
                                                          const raw = prompt("Rename branch", agent.branch ?? "")
                                                          if (!raw?.trim()) return
                                                          const sanitized = raw.trim().toLowerCase().replace(/[^a-z0-9/_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
                                                          if (sanitized.length < 1) return
                                                          onRenameBranch(agent.id, sanitized)
                                                        }}>
                                                          <Pencil />
                                                          Rename
                                                        </DropdownMenuItem>
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
                                                  >
                                                    <button
                                                      className="flex h-5 w-5 items-center justify-center rounded-md text-sidebar-foreground/70 ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                      onClick={(e) => { e.stopPropagation(); onAddIframeLayer(agent.id) }}
                                                      title={isLoading ? "Sandbox still starting…" : "Add frame"}
                                                      disabled={isLoading}
                                                    >
                                                      <Plus className="size-4" />
                                                    </button>
                                                  </AgentDropdownSlot>
                                                </>
                                              )
                                            })()}
                                          </div>
                                        </div>

                                        {agent.error && (
                                          <p className="px-2 pb-1 text-[10px] text-red-500">{agent.error}</p>
                                        )}
                                      </>
                                  </SidebarMenuItem>
                                </Collapsible>
                              )
                            })}

                          </SidebarMenu>
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

        <SidebarGroup>
          <SidebarGroupLabel>Frames</SidebarGroupLabel>
          <SidebarGroupContent>
            <Reorder.Group
              axis="y"
              values={iframeLayerGroups}
              onReorder={(items) => onReorderIframeLayerGroups(items.map((g) => g.id))}
              className="flex w-full min-w-0 flex-col gap-0"
            >
              {iframeLayerGroups.map((group) => {
                // Resolve members in their stored order, dropping any that
                // can't be found (lookup races during deletion). Each
                // entry pairs the member kind with the underlying data so
                // the dispatcher below can hand it straight to the right
                // row component without a per-kind branch.
                type ResolvedMember = { kind: string; id: string; data: unknown }
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
                 *  kinds plug in by adding an entry to that map up top. */
                const renderMember = (
                  member: { kind: string; id: string; data: unknown },
                  variant: "flat" | "sub",
                ) => {
                  const dispatch = rowDispatchByKind[member.kind]
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
                      />
                      <Menu
                        item={member.data}
                        isSub={variant === "sub"}
                        onRename={dispatch.onRename}
                        onChangeRoute={dispatch.onChangeRoute}
                        onRemove={dispatch.onRemove}
                      />
                    </>
                  )
                }

                // Single-member groups render flat — the group header would
                // be visual noise. The Reorder.Item still wraps it so the
                // row can be dragged to reorder the implicit group.
                if (groupMembers.length === 1) {
                  const m = groupMembers[0]!
                  return (
                    <Reorder.Item
                      key={group.id}
                      value={group}
                      layout="position"
                      className="group/menu-item group/frame-row relative cursor-grab active:cursor-grabbing"
                    >
                      {renderMember(m, "flat")}
                    </Reorder.Item>
                  )
                }

                return (
                  <Reorder.Item
                    key={group.id}
                    value={group}
                    layout="position"
                    data-slot="sidebar-menu-item"
                    data-sidebar="menu-item"
                    className="group/menu-item relative flex flex-col cursor-grab active:cursor-grabbing"
                  >
                    <Collapsible defaultOpen className="group/frame-collapsible flex flex-col">
                      <div className="group/frame-group-row relative">
                          <SidebarMenuButton
                            className="!pr-2 !transition-[width,height] group-hover/frame-group-row:!pr-7 group-focus-within/frame-group-row:!pr-7 group-has-data-[state=open]/frame-group-row:!pr-7"
                            isActive={selectedGroupIds.has(group.id)}
                            onClick={(e) => { e.stopPropagation(); onSelectGroup(group.id, e.shiftKey) }}
                            onDoubleClick={(e) => { e.stopPropagation(); onZoomToGroup(group.id) }}
                          >
                            <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <span className="relative shrink-0">
                                <Folder className="block group-hover/frame-group-row:hidden text-sidebar-foreground/70" />
                                <ChevronRight className="hidden group-hover/frame-group-row:block cursor-pointer text-sidebar-foreground/70 transition-transform group-data-[state=open]/frame-collapsible:rotate-90" />
                              </span>
                            </CollapsibleTrigger>
                            <span className="truncate font-medium text-sidebar-foreground/70">
                              {group.name ?? "Group"}
                            </span>
                          </SidebarMenuButton>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <SidebarMenuAction
                                className="md:opacity-0 group-hover/frame-group-row:opacity-100 group-focus-within/frame-group-row:opacity-100 aria-expanded:opacity-100"
                              >
                                <MoreHorizontal />
                              </SidebarMenuAction>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side="right" align="start" className="w-48">
                              <DropdownMenuItem onClick={() => {
                                const newName = prompt("Rename group", group.name ?? "Group")
                                if (newName?.trim()) onRenameIframeLayerGroup(group.id, newName.trim())
                              }}>
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
                        </div>
                        <CollapsibleContent>
                          <Reorder.Group
                            axis="y"
                            values={groupMembers}
                            onReorder={(items) =>
                              onReorderGroupMembers(
                                group.id,
                                items.map((m) => ({ kind: m.kind, id: m.id })) as GroupMember[],
                              )
                            }
                            data-slot="sidebar-menu-sub"
                            data-sidebar="menu-sub"
                            className="ml-3.5 mr-0 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border pl-1 pr-0 py-0.5"
                          >
                            {groupMembers.map((m) => (
                              <Reorder.Item
                                key={m.id}
                                value={m}
                                layout="position"
                                data-slot="sidebar-menu-sub-item"
                                data-sidebar="menu-sub-item"
                                className="group/menu-sub-item group/frame-row relative cursor-grab active:cursor-grabbing"
                              >
                                {renderMember(m, "sub")}
                              </Reorder.Item>
                            ))}
                          </Reorder.Group>
                        </CollapsibleContent>
                    </Collapsible>
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>
            {iframeLayerGroups.length === 0 && (
              <div className="py-8 text-center text-xs text-sidebar-foreground/50">
                No frames yet
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
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

