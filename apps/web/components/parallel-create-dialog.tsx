"use client"

import { useEffect, useMemo, useState } from "react"
import { Copy, GitBranch, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { listRepoBranches, type GitHubBranch } from "@/lib/github-actions"
import { getDefaultModelId, getModels, type ModelInfo } from "@/lib/models-store"

const LAST_MODEL_STORAGE_KEY = "agent-last-model"

function readStoredModel(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(LAST_MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

export interface ParallelAgentSpec {
  baseBranch: string
  model: string
  prompt: string
}

interface ParallelCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoOwner: string
  repoName: string
  defaultBranch: string
  onSubmit: (specs: ParallelAgentSpec[]) => void
}

export function ParallelCreateDialog({
  open,
  onOpenChange,
  repoOwner,
  repoName,
  defaultBranch,
  onSubmit,
}: ParallelCreateDialogProps) {
  const [rows, setRows] = useState<ParallelAgentSpec[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(null)

  // Stored model wins over the server default so a user who picked a model
  // last time keeps that choice; the server default is only used the first
  // time. Empty string until both stores have answered to avoid kicking off
  // with a stale id.
  const initialModel = (readStoredModel() ?? serverDefaultModel) || ""

  // Reset rows whenever the dialog re-opens so reopening the dialog gives a
  // fresh starting state instead of stale prompts from the previous session.
  useEffect(() => {
    if (!open) return
    setRows([{ baseBranch: defaultBranch, model: initialModel, prompt: "" }])
  }, [open, defaultBranch, initialModel])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBranchesLoading(true)
    listRepoBranches(repoOwner, repoName)
      .then((data) => {
        if (cancelled) return
        // Surface the default branch first so it's a one-click pick.
        const sorted = [...data].sort((a, b) => {
          if (a.name === defaultBranch) return -1
          if (b.name === defaultBranch) return 1
          return a.name.localeCompare(b.name)
        })
        setBranches(sorted)
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, repoOwner, repoName, defaultBranch])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([getModels(), getDefaultModelId()])
      .then(([list, def]) => {
        if (cancelled) return
        setModels(list)
        setServerDefaultModel(def)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const modelGroups = useMemo(() => {
    const order: string[] = []
    const byKey = new Map<
      string,
      { key: string; label: string; models: ModelInfo[] }
    >()
    for (const m of models) {
      let group = byKey.get(m.provider.key)
      if (!group) {
        group = { key: m.provider.key, label: m.provider.label, models: [] }
        byKey.set(m.provider.key, group)
        order.push(m.provider.key)
      }
      group.models.push(m)
    }
    return order.map((k) => byKey.get(k)!)
  }, [models])

  const updateRow = (idx: number, patch: Partial<ParallelAgentSpec>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const duplicateRow = (idx: number) => {
    setRows((prev) => {
      const source = prev[idx] ?? prev[prev.length - 1]
      if (!source) return prev
      const next = [...prev]
      next.splice(idx + 1, 0, { ...source })
      return next
    })
  }

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  const validRows = rows.filter((r) => r.prompt.trim() && r.baseBranch && r.model)
  const canSubmit = validRows.length > 0 && validRows.length === rows.length

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(rows.map((r) => ({ ...r, prompt: r.prompt.trim() })))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Parallel agents</DialogTitle>
          <DialogDescription>
            Spin up multiple branches at once. Each row creates a branch and sends
            its prompt to a fresh agent chat as soon as the sandbox is ready.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Agent {idx + 1}
                </span>
                <div className="flex-1" />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title="Duplicate row"
                  onClick={() => duplicateRow(idx)}
                >
                  <Copy />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title="Remove row"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(idx)}
                >
                  <Trash2 />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Base branch
                  </label>
                  <Select
                    value={row.baseBranch}
                    onValueChange={(v) => updateRow(idx, { baseBranch: v })}
                  >
                    <SelectTrigger size="sm" className="text-xs">
                      <SelectValue placeholder="Select branch">
                        <span className="flex items-center gap-1.5">
                          <GitBranch className="size-3.5 text-muted-foreground" />
                          <span className="truncate font-mono text-xs">
                            {row.baseBranch || "Select branch"}
                          </span>
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {branchesLoading && branches.length === 0 ? (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                          <Spinner className="size-3" />
                          Loading branches…
                        </div>
                      ) : branches.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No branches found.
                        </div>
                      ) : (
                        branches.map((b) => (
                          <SelectItem key={b.name} value={b.name} className="text-xs">
                            <span className="font-mono">{b.name}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Model
                  </label>
                  <Select
                    value={row.model}
                    onValueChange={(v) => updateRow(idx, { model: v })}
                  >
                    <SelectTrigger size="sm" className="text-xs">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Loading…
                        </div>
                      ) : (
                        modelGroups.map((group, gIdx) => (
                          <SelectGroup key={group.key}>
                            {gIdx > 0 && <SelectSeparator />}
                            <SelectLabel className="text-xs">{group.label}</SelectLabel>
                            {group.models.map((m) => (
                              <SelectItem
                                key={m.id}
                                value={m.id}
                                className="text-xs"
                              >
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Prompt
                </label>
                <Textarea
                  value={row.prompt}
                  onChange={(e) => updateRow(idx, { prompt: e.target.value })}
                  placeholder="What should this agent do?"
                  rows={3}
                  className="resize-y text-xs"
                />
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-xs"
            onClick={() => duplicateRow(rows.length - 1)}
          >
            <Plus />
            Add another (copies previous)
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {rows.length === 1
              ? "Create agent"
              : `Create ${rows.length} agents`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
