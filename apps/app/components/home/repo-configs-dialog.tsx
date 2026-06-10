"use client"

import { useEffect, useState } from "react"
import { Folder, FolderLock, Plus, Pencil, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Spinner } from "@workspace/ui/components/spinner"
import { RepoConfigForm } from "@/components/home/repo-config-form"
import { deleteRepoConfig, listRepoConfigs } from "@/lib/repo-configs-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { isLocalBuild } from "@/lib/local-mode"

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; config: RepoConfig }

interface RepoConfigsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoConfigsDialog({
  open,
  onOpenChange,
}: RepoConfigsDialogProps) {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Reset the view (mode + loading) the moment the dialog opens, using the
  // render-phase previous-value pattern instead of a synchronous setState in
  // the effect below. The effect is left to drive the async fetch only.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode({ kind: "list" })
      setLoading(true)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listRepoConfigs()
      .then((list) => {
        if (!cancelled) setConfigs(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const updated = await deleteRepoConfig(id)
      setConfigs(updated)
    } finally {
      setDeletingId(null)
    }
  }

  const grouped = new Map<string, RepoConfig[]>()
  for (const c of configs) {
    const list = grouped.get(c.repoFullName) ?? []
    list.push(c)
    grouped.set(c.repoFullName, list)
  }
  const sortedRepos = Array.from(grouped.keys()).sort((a, b) =>
    a.localeCompare(b)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "new"
              ? "New configuration"
              : mode.kind === "edit"
                ? "Edit configuration"
                : "Configured repositories"}
          </DialogTitle>
          <DialogDescription>
            {mode.kind === "list"
              ? "Saved per-repo setup, dev, port, and env-vars. Applied when you add a workspace inside a room."
              : "Settings are copied into any new workspace you create for this repo."}
          </DialogDescription>
        </DialogHeader>

        {mode.kind === "list" ? (
          <div className="flex min-w-0 flex-col gap-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <Spinner className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading…</span>
              </div>
            ) : configs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No saved configurations yet.
              </p>
            ) : (
              <ScrollArea className="max-h-[60vh]">
                <div className="flex flex-col gap-3 pr-3">
                  {sortedRepos.map((repoFullName) => {
                    const items = grouped
                      .get(repoFullName)!
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                    return (
                      <div
                        key={repoFullName}
                        className="flex min-w-0 flex-col gap-1"
                      >
                        <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          {items[0].private ? (
                            <FolderLock className="size-3.5 shrink-0" />
                          ) : (
                            <Folder className="size-3.5 shrink-0" />
                          )}
                          <span className="truncate">{repoFullName}</span>
                        </div>
                        {items.map((config) => (
                          <div
                            key={config.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1 truncate text-sm">
                              {config.name || (
                                <span className="text-muted-foreground">
                                  default
                                </span>
                              )}
                              {/* Desktop hides the port: it's a logical key
                                  there — portless assigns the real one. */}
                              {!isLocalBuild && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  port {config.devServerPort}
                                </span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setMode({ kind: "edit", config })}
                            >
                              <Pencil className="size-3.5" />
                              <span className="sr-only">Edit</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleDelete(config.id)}
                              disabled={deletingId === config.id}
                            >
                              <Trash2 className="size-3.5" />
                              <span className="sr-only">Delete</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => setMode({ kind: "new" })}
                disabled={loading}
              >
                <Plus className="size-3.5" />
                New configuration
              </Button>
            </div>
          </div>
        ) : (
          <RepoConfigForm
            initial={mode.kind === "edit" ? mode.config : undefined}
            existingConfigs={configs}
            onSaved={(updated) => {
              setConfigs(updated)
              setMode({ kind: "list" })
            }}
            onCancel={() => setMode({ kind: "list" })}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
