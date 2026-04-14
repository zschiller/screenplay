"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import {
  FolderPlus,
  Plus,
  Folder,
  FolderLock,
  Loader2,
  Settings,
  ChevronRight,
  GitBranch,
  GitBranchPlus,
  GitFork,
  RefreshCw,
  Trash2,
  Frame,
  MoreHorizontal,
  Pencil,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
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
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { BranchBadge } from "@/components/branch-badge"
import type { AgentData, ArtboardData, WorkspaceData } from "@/lib/liveblocks.types"
import { listUserRepos, listRepoBranches, type GitHubRepo, type GitHubBranch } from "@/lib/github-actions"

interface AgentSidebarProps {
  workspaces: WorkspaceData[]
  agents: AgentData[]
  artboards: Array<Pick<ArtboardData, "id" | "sandboxId" | "label" | "route">>
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onCreateWorkspace: (repo: GitHubRepo) => void
  onUpdateWorkspace: (id: string, data: Partial<WorkspaceData>) => void
  onRemoveWorkspace: (id: string) => void
  onCreateAgent: (workspaceId: string) => void
  onCreateAgentFromBranch: (workspaceId: string, branch: string) => void
  onDuplicateBranch: (workspaceId: string, branch: string) => void
  onForkAgent: (agentId: string) => void
  onRefreshAgent: (id: string) => void
  onRemoveAgent: (id: string) => void
  onAddArtboard: (agentId: string) => void
  onUpdateAgent: (id: string, data: Partial<AgentData>) => void
  onRenameBranch: (agentId: string, newBranch: string) => void
  onSelectArtboard: (artboardId: string) => void
  onRenameArtboard: (id: string, label: string) => void
  onRemoveArtboard: (id: string) => void
}

export function AgentSidebar({
  workspaces,
  agents,
  artboards,
  selectedAgentId,
  onSelectAgent,
  onCreateWorkspace,
  onUpdateWorkspace,
  onRemoveWorkspace,
  onCreateAgent,
  onCreateAgentFromBranch,
  onDuplicateBranch,
  onForkAgent,
  onRefreshAgent,
  onRemoveAgent,
  onAddArtboard,
  onUpdateAgent,
  onRenameBranch,
  onSelectArtboard,
  onRenameArtboard,
  onRemoveArtboard,
}: AgentSidebarProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null)
  const [branchPickerWorkspaceId, setBranchPickerWorkspaceId] = useState<string | null>(null)

  // Auto-select agents when they finish creating
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const prev = prevStatusRef.current
    for (const agent of agents) {
      const was = prev.get(agent.id)
      if ((was === "creating" || was === "starting") && agent.status === "running") {
        onSelectAgent(agent.id)
      }
    }
    prevStatusRef.current = new Map(agents.map((a) => [a.id, a.status]))
  }, [agents, onSelectAgent])

  return (
    <SidebarProvider className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto" onClick={() => { onSelectAgent(null) }}>
        <SidebarGroup>
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
          <Popover open={showPicker} onOpenChange={setShowPicker}>
            <PopoverTrigger asChild>
              <SidebarGroupAction title="Add workspace">
                <FolderPlus />
              </SidebarGroupAction>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" side="bottom" align="end">
              <RepoPicker
                onSelect={(repo) => {
                  onCreateWorkspace(repo)
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
                        <div className="group/workspace-row relative">
                          <SidebarMenuButton className="!pr-[4.5rem]" onClick={(e) => e.stopPropagation()}>
                            <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <span className="relative shrink-0">
                                <Folder className="block group-hover/workspace-row:hidden text-sidebar-foreground/70" />
                                <ChevronRight className="hidden group-hover/workspace-row:block cursor-pointer text-sidebar-foreground/70 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                              </span>
                            </CollapsibleTrigger>
                            <span className="truncate font-medium text-sidebar-foreground/70">{workspace.repoFullName}</span>
                          </SidebarMenuButton>

                          <Popover
                            open={settingsWorkspaceId === workspace.id}
                            onOpenChange={(open) => setSettingsWorkspaceId(open ? workspace.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <SidebarMenuAction
                                className="right-[3.25rem] md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100 aria-expanded:opacity-100"
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
                                  onRemoveWorkspace(workspace.id)
                                }}
                                onClose={() => setSettingsWorkspaceId(null)}
                              />
                            </PopoverContent>
                          </Popover>
                          <SidebarMenuAction
                            className="right-7 md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100"
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
                            className="md:opacity-0 group-hover/workspace-row:opacity-100 group-focus-within/workspace-row:opacity-100 aria-expanded:opacity-100"
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
                              const agentArtboards = artboards.filter((a) => a.sandboxId === agent.id)

                              return (
                                <Collapsible
                                  key={agent.id}
                                  asChild
                                  defaultOpen
                                  className="group/collapsible-agent"
                                >
                                  <SidebarMenuItem>
                                    {isLoading ? (
                                      <SidebarMenuButton disabled className="pointer-events-none opacity-60">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
                                        <span className="truncate text-xs text-muted-foreground">
                                          {agent.statusMessage || "Creating…"}
                                        </span>
                                      </SidebarMenuButton>
                                    ) : (
                                      <>
                                        <div className="group/agent-row relative">
                                          <SidebarMenuButton
                                            className="!pr-14"
                                            isActive={selectedAgentId === agent.id}
                                            onClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id) }}
                                          >
                                            <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
                                              <span className="relative shrink-0">
                                                <GitBranch className="block group-hover/agent-row:hidden text-sidebar-foreground/70" />
                                                <ChevronRight className="hidden group-hover/agent-row:block cursor-pointer text-sidebar-foreground/70 transition-transform group-data-[state=open]/collapsible-agent:rotate-90" />
                                              </span>
                                            </CollapsibleTrigger>
                                            {agent.branch ? (
                                              <BranchBadge branch={agent.branch} colorKey={agent.id} className="text-[11px] py-0 px-1.5" />
                                            ) : (
                                              <span className="truncate font-mono text-xs text-muted-foreground">creating...</span>
                                            )}
                                          </SidebarMenuButton>

                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <SidebarMenuAction
                                                className="right-7 md:opacity-0 group-hover/agent-row:opacity-100 group-focus-within/agent-row:opacity-100 aria-expanded:opacity-100"
                                              >
                                                <MoreHorizontal />
                                              </SidebarMenuAction>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent side="right" align="start" className="w-48">
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
                                              <DropdownMenuSeparator />
                                              <DropdownMenuItem className="text-destructive" onClick={() => onRemoveAgent(agent.id)}>
                                                <Trash2 />
                                                Delete
                                              </DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                          <SidebarMenuAction
                                            className="md:opacity-0 group-hover/agent-row:opacity-100 group-focus-within/agent-row:opacity-100"
                                            onClick={(e) => { e.stopPropagation(); onAddArtboard(agent.id) }}
                                            title="Add frame"
                                          >
                                            <Plus />
                                          </SidebarMenuAction>
                                        </div>

                                        {agent.error && (
                                          <p className="px-2 pb-1 text-[10px] text-red-500">{agent.error}</p>
                                        )}
                                      </>
                                    )}

                                    <CollapsibleContent>
                                      <SidebarMenuSub>
                                        {agentArtboards.map((ab) => (
                                          <SidebarMenuSubItem key={ab.id}>
                                            <div className="group/frame-row relative">
                                              <SidebarMenuSubButton className="w-full !pr-7" onClick={(e) => { e.stopPropagation(); onSelectArtboard(ab.id) }}>
                                                <Frame className="text-sidebar-foreground/70" />
                                                <span>{ab.label}</span>
                                                <Badge variant="outline" className="max-w-[6rem] shrink-0 border-transparent bg-sidebar-accent font-mono text-[10px] text-sidebar-foreground/60 py-0 px-1.5">
                                                  <span className="truncate">{ab.route || "/"}</span>
                                                </Badge>
                                              </SidebarMenuSubButton>
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <SidebarMenuAction
                                                    className="!top-1 md:opacity-0 group-hover/frame-row:opacity-100 group-focus-within/frame-row:opacity-100 aria-expanded:opacity-100"
                                                  >
                                                    <MoreHorizontal />
                                                  </SidebarMenuAction>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent side="right" align="start">
                                                  <DropdownMenuItem onClick={() => {
                                                    const newLabel = prompt("Rename frame", ab.label)
                                                    if (newLabel?.trim()) onRenameArtboard(ab.id, newLabel.trim())
                                                  }}>
                                                    <Pencil />
                                                    Rename
                                                  </DropdownMenuItem>
                                                  <DropdownMenuSeparator />
                                                  <DropdownMenuItem className="text-destructive" onClick={() => onRemoveArtboard(ab.id)}>
                                                    <Trash2 />
                                                    Delete
                                                  </DropdownMenuItem>
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            </div>
                                          </SidebarMenuSubItem>
                                        ))}
                                      </SidebarMenuSub>
                                    </CollapsibleContent>
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
      </div>
    </SidebarProvider>
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
  const [setupScript, setSetupScript] = useState(workspace.setupScript)
  const [devScript, setDevScript] = useState(workspace.devScript)
  const [envVars, setEnvVars] = useState(workspace.envVars)

  const handleSave = useCallback(() => {
    onUpdate(workspace.id, { setupScript, devScript, envVars })
    onClose()
  }, [workspace.id, setupScript, devScript, envVars, onUpdate, onClose])

  const hasChanges =
    setupScript !== workspace.setupScript ||
    devScript !== workspace.devScript ||
    envVars !== workspace.envVars

  return (
    <div className="space-y-3">
      <span className="text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wide">
        Settings
      </span>

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

      <div className="flex items-center gap-2">
        <Button size="sm" className="flex-1 text-xs" onClick={handleSave} disabled={!hasChanges}>
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

function RepoPicker({
  onSelect,
}: {
  onSelect: (repo: GitHubRepo) => void
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const data = await listUserRepos()
      setRepos(data)
    })
  }, [])

  return (
    <Command>
      <CommandInput placeholder="Search repositories..." />
      <CommandList>
        <CommandEmpty>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading repositories…</span>
            </div>
          ) : (
            "No repositories found."
          )}
        </CommandEmpty>
        <CommandGroup>
          {repos.map((repo) => (
            <CommandItem
              key={repo.id}
              value={repo.fullName}
              onSelect={() => onSelect(repo)}
            >
              {repo.private ? <FolderLock /> : <Folder />}
              <span className="truncate">{repo.fullName}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
