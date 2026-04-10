"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import {
  Plus,
  PanelRightClose,
  PanelRight,
  Search,
  Lock,
  Loader2,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SandboxCard } from "./sandbox-card"
import type { SandboxData } from "@/lib/liveblocks.types"
import {
  listUserRepos,
  listRepoBranches,
  type GitHubRepo,
  type GitHubBranch,
} from "@/lib/github-actions"

interface SandboxPanelProps {
  sandboxes: SandboxData[]
  onCreateSandbox: (gitUrl: string, branch: string, env?: Record<string, string>) => void
  onRefresh: (id: string) => void
  onRemove: (id: string) => void
  onAddArtboard: (sandboxId: string) => void
}

export function SandboxPanel({
  sandboxes,
  onCreateSandbox,
  onRefresh,
  onRemove,
  onAddArtboard,
}: SandboxPanelProps) {
  const [open, setOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="fixed right-4 top-4 z-50 h-8 w-8 bg-background/80 shadow-sm backdrop-blur-sm"
        onClick={() => setOpen(true)}
      >
        <PanelRight className="h-4 w-4" />
      </Button>
    )
  }

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium">Sandboxes</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setOpen(false)}
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {sandboxes.map((sandbox) => (
            <SandboxCard
              key={sandbox.id}
              sandbox={sandbox}
              onRefresh={onRefresh}
              onRemove={onRemove}
              onAddArtboard={onAddArtboard}
            />
          ))}
        </div>

        {sandboxes.length === 0 && !showPicker && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No sandboxes yet
          </p>
        )}

        {showPicker ? (
          <RepoPicker
            onSelect={(cloneUrl, branch, env) => {
              onCreateSandbox(cloneUrl, branch, env)
              setShowPicker(false)
            }}
            onCancel={() => setShowPicker(false)}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full text-xs"
            onClick={() => setShowPicker(true)}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add Sandbox
          </Button>
        )}
      </div>
    </div>
  )
}

function RepoPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (cloneUrl: string, branch: string, env?: Record<string, string>) => void
  onCancel: () => void
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, startTransition] = useTransition()
  const [search, setSearch] = useState("")
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null)
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [envVars, setEnvVars] = useState("")
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [loadingBranches, startBranchTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const data = await listUserRepos()
      setRepos(data)
    })
  }, [])

  const handleSelectRepo = useCallback((repo: GitHubRepo) => {
    setSelectedRepo(repo)
    setSelectedBranch(repo.defaultBranch)
    startBranchTransition(async () => {
      const data = await listRepoBranches(repo.owner, repo.name)
      setBranches(data)
    })
  }, [])

  const filtered = repos.filter(
    (r) =>
      r.fullName.toLowerCase().includes(search.toLowerCase()) ||
      r.name.toLowerCase().includes(search.toLowerCase()),
  )

  if (selectedRepo) {
    return (
      <div className="mt-3 space-y-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            {selectedRepo.private && (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-mono text-xs">
              {selectedRepo.fullName}
            </span>
          </div>

          <div className="relative mt-2">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full appearance-none rounded-md border border-input bg-background px-2.5 py-1.5 pr-8 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              disabled={loadingBranches}
            >
              {loadingBranches ? (
                <option>Loading branches...</option>
              ) : (
                branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowEnvVars(!showEnvVars)}
            className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showEnvVars ? "" : "-rotate-90"}`}
            />
            Environment variables
          </button>
          {showEnvVars && (
            <textarea
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              placeholder={"KEY=value\nANOTHER_KEY=value"}
              className="mb-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-[10px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              rows={4}
            />
          )}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 text-xs"
            onClick={() => {
              const env = parseEnvVars(envVars)
              onSelect(
                selectedRepo.cloneUrl,
                selectedBranch,
                Object.keys(env).length > 0 ? env : undefined,
              )
            }}
            disabled={!selectedBranch || loadingBranches}
          >
            Create Sandbox
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              setSelectedRepo(null)
              setBranches([])
            }}
          >
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
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
              onClick={() => handleSelectRepo(repo)}
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

function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) env[key] = value
  }
  return env
}
