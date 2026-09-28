"use client"

import { useCallback, useEffect, useState } from "react"
import { Folder, Plus } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { LoadErrorRow } from "@/components/home/load-error"
import { RepoConfigForm } from "@/components/home/repo-config-form"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "@/components/home/settings-row"
import { deleteRepoConfig, listRepoConfigs } from "@/lib/repo-configs-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { isLocalBuild } from "@/lib/local-mode"
import { ConfirmDialog } from "@/components/confirm-dialog"

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; config: RepoConfig }

/**
 * Manages saved Project presets (per-repo setup/dev/port/env), one settings row
 * each, sorted by project. Lives on the Settings page; new/edit opens the form
 * in a dialog over the list, so the editor never nests a scroll area inside the
 * page's own scroll.
 */
export function RepoConfigsPanel() {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  // The preset awaiting delete confirmation; the confirm owns pending + error.
  const [pendingDelete, setPendingDelete] = useState<RepoConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    listRepoConfigs()
      .then((list) => {
        if (!cancelled) setConfigs(list)
      })
      .catch((err) => {
        console.error("Failed to load project presets", err)
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Retry after a failed load; a second failure rejects and leaves the error up.
  const reload = useCallback(async () => {
    setConfigs(await listRepoConfigs())
    setLoadFailed(false)
  }, [])

  const handleDelete = async (id: string) => {
    const updated = await deleteRepoConfig(id)
    setConfigs(updated)
    setPendingDelete(null)
  }

  // Grouping has two cases in one list (ADR 0013). A preset with a detected
  // git remote keeps *remote identity*: keyed/displayed by `repoFullName`, so a
  // folder-added preset for `owner/repo` lands in the same group as a GitHub- or
  // URL-added one and dedupes. A genuinely remote-less folder falls back to
  // *path identity*: keyed by its `localPath`, headed by the folder basename
  // with the full path in its facts line.
  const sortedGroups = groupConfigs(configs)

  const newPreset = (
    <Button size="sm" onClick={() => setMode({ kind: "new" })}>
      <Plus className="size-3.5" />
      New preset
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {loading ? (
        <SettingsRowSkeleton label="Loading project presets…" count={2} />
      ) : loadFailed ? (
        <LoadErrorRow title="Couldn't load project presets" onRetry={reload} />
      ) : configs.length === 0 ? (
        <Empty className="border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Folder />
            </EmptyMedia>
            <EmptyTitle>No project presets yet</EmptyTitle>
            <EmptyDescription>
              Save a project&apos;s setup and dev scripts once, and every canvas
              you add it to starts from them.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newPreset}</EmptyContent>
        </Empty>
      ) : (
        <>
          <SettingsRowList>
            {sortedGroups.flatMap((group) =>
              group.items
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((config) => (
                  <SettingsRow
                    key={config.id}
                    title={group.heading}
                    state={group.private ? "Private" : undefined}
                    detail={presetDetail(config, group)}
                    action={
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setMode({ kind: "edit", config })}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingDelete(config)}
                        >
                          Delete
                        </Button>
                      </>
                    }
                  />
                ))
            )}
          </SettingsRowList>
          <div className="flex justify-end">{newPreset}</div>
        </>
      )}

      <Dialog
        open={mode.kind !== "list"}
        onOpenChange={(open) => {
          if (!open) setMode({ kind: "list" })
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="px-4 pt-4 pb-3">
            <DialogTitle>
              {mode.kind === "edit" ? "Edit preset" : "New preset"}
            </DialogTitle>
            <DialogDescription>
              Applied when you add this project to a canvas.
            </DialogDescription>
          </DialogHeader>
          {mode.kind !== "list" && (
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

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        verb="Delete"
        itemName={pendingDelete?.name}
        itemNoun="preset"
        description={
          pendingDelete ? (
            <>
              Adding{" "}
              <span className="font-mono">
                {presetOwnerLabel(pendingDelete)}
              </span>{" "}
              to a canvas will no longer start from this preset. Projects
              already on a canvas keep their settings.
            </>
          ) : null
        }
        onConfirm={() => handleDelete(pendingDelete!.id)}
      />
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

/**
 * A preset row's detail line: which preset of the project it is, then — for a
 * remote-less folder — the full path its heading abbreviates. The web build adds
 * the port; desktop hides it, since there it's a logical key portless remaps.
 */
function presetDetail(config: RepoConfig, group: ConfigGroup): string {
  return [
    config.name ? `${config.name} preset` : "Default preset",
    !isLocalBuild && `port ${config.devServerPort}`,
    group.subtext,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** A folder preset with no detected remote falls back to path identity. */
function isPathIdentity(c: RepoConfig): boolean {
  return Boolean(c.localPath) && !c.repoOwner
}

/** The project a preset belongs to, as its group heading shows it. */
function presetOwnerLabel(c: RepoConfig): string {
  return isPathIdentity(c) ? basename(c.localPath!) : c.repoFullName
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
