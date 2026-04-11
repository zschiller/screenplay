"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import {
  Plus,
  PanelLeftClose,
  Search,
  Lock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Settings,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { AgentCard } from "./agent-card"
import type { AgentData, ArtboardData, WorkspaceData } from "@/lib/liveblocks.types"
import { listUserRepos, type GitHubRepo } from "@/lib/github-actions"

interface AgentSidebarProps {
  workspaces: WorkspaceData[]
  agents: AgentData[]
  artboards: Array<Pick<ArtboardData, "id" | "sandboxId" | "label">>
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onCreateWorkspace: (repo: GitHubRepo) => void
  onUpdateWorkspace: (id: string, data: Partial<WorkspaceData>) => void
  onRemoveWorkspace: (id: string) => void
  onCreateAgent: (workspaceId: string) => void
  onForkAgent: (agentId: string) => void
  onRefreshAgent: (id: string) => void
  onRemoveAgent: (id: string) => void
  onAddArtboard: (agentId: string) => void
  onUpdateAgent: (id: string, data: Partial<AgentData>) => void
  onClose: () => void
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
  onForkAgent,
  onRefreshAgent,
  onRemoveAgent,
  onAddArtboard,
  onUpdateAgent,
  onClose,
}: AgentSidebarProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null)

  const toggleWorkspace = useCallback((id: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium">Workspaces</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowPicker(true)}
            title="Add workspace"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Workspace list — click empty space to deselect */}
      <div className="flex-1 overflow-y-auto" onClick={() => onSelectAgent(null)}>
        <div className="p-3 space-y-1">
          {workspaces
            .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName))
            .map((workspace) => {
              const collapsed = collapsedWorkspaces.has(workspace.id)
              const workspaceAgents = agents
                .filter((a) => a.workspaceId === workspace.id)
                .sort((a, b) => a.createdAt - b.createdAt)
              const showSettings = settingsWorkspaceId === workspace.id

              return (
                <div key={workspace.id}>
                  {/* Workspace header */}
                  <div className="flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 min-w-0"
                      onClick={() => toggleWorkspace(workspace.id)}
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {workspace.repoFullName}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        {workspaceAgents.length}
                      </span>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() =>
                          setSettingsWorkspaceId(showSettings ? null : workspace.id)
                        }
                        title="Workspace settings"
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => onCreateAgent(workspace.id)}
                        title="New agent"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Workspace settings */}
                  {showSettings && (
                    <WorkspaceSettings
                      workspace={workspace}
                      onUpdate={onUpdateWorkspace}
                      onRemove={() => {
                        setSettingsWorkspaceId(null)
                        onRemoveWorkspace(workspace.id)
                      }}
                      onClose={() => setSettingsWorkspaceId(null)}
                    />
                  )}

                  {/* Agent list */}
                  {!collapsed && (
                    <div className="ml-2 mt-1 space-y-1">
                      {workspaceAgents.map((agent) => (
                        <AgentCard
                          key={agent.id}
                          agent={agent}
                          selected={selectedAgentId === agent.id}
                          artboards={artboards.filter((a) => a.sandboxId === agent.id)}
                          onSelect={onSelectAgent}
                          onFork={onForkAgent}
                          onRefresh={onRefreshAgent}
                          onRemove={onRemoveAgent}
                          onAddArtboard={onAddArtboard}
                        />
                      ))}
                      {workspaceAgents.length === 0 && (
                        <p className="py-2 pl-4 text-[10px] text-muted-foreground">
                          No agents yet
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

          {workspaces.length === 0 && !showPicker && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No workspaces yet
            </p>
          )}

          {showPicker && (
            <RepoPicker
              onSelect={(repo) => {
                onCreateWorkspace(repo)
                setShowPicker(false)
              }}
              onCancel={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>
    </div>
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
    <div className="ml-2 mt-1 rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Settings
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-muted-foreground">
          Setup script
        </label>
        <input
          type="text"
          value={setupScript}
          onChange={(e) => setSetupScript(e.target.value)}
          placeholder="npm install"
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-muted-foreground">
          Dev script
        </label>
        <input
          type="text"
          value={devScript}
          onChange={(e) => setDevScript(e.target.value)}
          placeholder="npm run dev"
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-muted-foreground">
          Environment variables
        </label>
        <textarea
          value={envVars}
          onChange={(e) => setEnvVars(e.target.value)}
          placeholder={"KEY=value\nANOTHER_KEY=value"}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-[10px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={handleSave}
          disabled={!hasChanges}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

function RepoPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (repo: GitHubRepo) => void
  onCancel: () => void
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, startTransition] = useTransition()
  const [search, setSearch] = useState("")

  useEffect(() => {
    startTransition(async () => {
      const data = await listUserRepos()
      setRepos(data)
    })
  }, [])

  const filtered = repos.filter(
    (r) =>
      r.fullName.toLowerCase().includes(search.toLowerCase()) ||
      r.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="mt-2 space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          autoFocus
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {search ? "No repos found" : "No repositories"}
          </p>
        ) : (
          filtered.map((repo) => (
            <button
              key={repo.id}
              onClick={() => onSelect(repo)}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted/50"
            >
              {repo.private && (
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">
                  {repo.fullName}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {repo.defaultBranch}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs"
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  )
}
