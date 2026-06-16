"use client"

import { useEffect, useState } from "react"
import {
  Folder,
  FolderLock,
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { RepoConfigForm } from "@/components/home/repo-config-form"
import { deleteRepoConfig, listRepoConfigs } from "@/lib/repo-configs-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { isLocalBuild } from "@/lib/local-mode"

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; config: RepoConfig }

/**
 * Manages saved Project presets (per-repo setup/dev/port/env), grouped by repo.
 * Lives on the Settings page; the form swaps in for new/edit and returns to the
 * list on save or cancel.
 */
export function RepoConfigsPanel() {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
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
  }, [])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const updated = await deleteRepoConfig(id)
      setConfigs(updated)
    } finally {
      setDeletingId(null)
    }
  }

  if (mode.kind !== "list") {
    return (
      <RepoConfigForm
        initial={mode.kind === "edit" ? mode.config : undefined}
        existingConfigs={configs}
        onSaved={(updated) => {
          setConfigs(updated)
          setMode({ kind: "list" })
        }}
        onCancel={() => setMode({ kind: "list" })}
      />
    )
  }

  // Grouping has two cases in one list (ADR 0013). A preset with a detected
  // git remote keeps *remote identity*: keyed/displayed by `repoFullName`, so a
  // folder-added preset for `owner/repo` lands in the same group as a GitHub- or
  // URL-added one and dedupes. A genuinely remote-less folder falls back to
  // *path identity*: keyed by its `localPath`, headed by the folder basename
  // with the full path as muted subtext and a distinct local-folder icon.
  const sortedGroups = groupConfigs(configs)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6">
          <Spinner className="size-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : configs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No project presets yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedGroups.map((group) => {
            const items = group.items
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
            return (
              <div key={group.key} className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  {group.kind === "path" ? (
                    <FolderOpen className="size-3.5 shrink-0" />
                  ) : group.private ? (
                    <FolderLock className="size-3.5 shrink-0" />
                  ) : (
                    <Folder className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{group.heading}</span>
                </div>
                {group.subtext && (
                  <div className="truncate pl-5 font-mono text-[11px] text-muted-foreground/70">
                    {group.subtext}
                  </div>
                )}
                {items.map((config) => (
                  <div
                    key={config.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 truncate text-sm">
                      {config.name || (
                        <span className="text-muted-foreground">default</span>
                      )}
                      {/* Desktop hides the port: it's a logical key there —
                          portless assigns the real one. */}
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
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => setMode({ kind: "new" })}
          disabled={loading}
        >
          <Plus className="size-3.5" />
          New preset
        </Button>
      </div>
    </div>
  )
}

type ConfigGroup = {
  key: string
  heading: string
  /** Full folder path, shown muted under the heading for path-identity groups. */
  subtext?: string
  kind: "remote" | "path"
  private: boolean
  items: RepoConfig[]
}

/** A folder preset with no detected remote falls back to path identity. */
function isPathIdentity(c: RepoConfig): boolean {
  return Boolean(c.localPath) && !c.repoOwner
}

/** Trailing path segment, tolerant of POSIX and Windows separators. */
function basename(p: string): string {
  return (
    p
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() || p
  )
}

/**
 * Fold presets into display groups (ADR 0013): remote-identity groups keyed by
 * `repoFullName`, path-identity groups keyed by `localPath`. Sorted by heading
 * so the two cases interleave as one list.
 */
function groupConfigs(configs: RepoConfig[]): ConfigGroup[] {
  const groups = new Map<string, ConfigGroup>()
  for (const c of configs) {
    const path = isPathIdentity(c)
    const key = path ? `path:${c.localPath}` : `repo:${c.repoFullName}`
    let group = groups.get(key)
    if (!group) {
      group = path
        ? {
            key,
            heading: basename(c.localPath!),
            subtext: c.localPath,
            kind: "path",
            private: false,
            items: [],
          }
        : {
            key,
            heading: c.repoFullName,
            kind: "remote",
            private: c.private,
            items: [],
          }
      groups.set(key, group)
    }
    group.items.push(c)
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.heading.localeCompare(b.heading)
  )
}
