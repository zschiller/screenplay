"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Copy,
  Folder,
  FolderLock,
  FolderOpen,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react"
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
import { duplicateName, presetSummary } from "@/lib/preset-summary"
import { isLocalBuild } from "@/lib/local-mode"
import { ConfirmDialog } from "@/components/confirm-dialog"

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; config: RepoConfig }
  | { kind: "duplicate"; config: RepoConfig }

const DIALOG_TITLE: Record<Exclude<Mode["kind"], "list">, string> = {
  new: "New preset",
  edit: "Edit preset",
  duplicate: "Duplicate preset",
}

/**
 * Manages saved Project presets (per-repo setup/dev/port/env), one settings row
 * each, sorted by project. Lives on the Settings page; new/edit/duplicate opens
 * the form in a dialog over the list, so the editor never nests a scroll area
 * inside the page's own scroll.
 */
export function RepoConfigsPanel() {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  // The preset awaiting delete confirmation; the confirm owns pending + error.
  const [pendingDelete, setPendingDelete] = useState<RepoConfig | null>(null)
  // Whether the open form differs from what it opened with; closing a changed
  // form asks first (#784). A ref, since only the close path reads it.
  const formDirty = useRef(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

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

  const openForm = (next: Exclude<Mode, { kind: "list" }>) => {
    formDirty.current = false
    setMode(next)
  }

  const closeForm = () => {
    formDirty.current = false
    setConfirmDiscard(false)
    setMode({ kind: "list" })
  }

  // Cancel, Escape, the close button and an outside click all land here.
  const requestCloseForm = () => {
    if (formDirty.current) setConfirmDiscard(true)
    else closeForm()
  }

  // Grouping has two cases in one list (ADR 0013). A preset with a detected
  // git remote keeps *remote identity*: keyed/displayed by `repoFullName`, so a
  // folder-added preset for `owner/repo` lands in the same group as a GitHub- or
  // URL-added one and dedupes. A genuinely remote-less folder falls back to
  // *path identity*: keyed by its `localPath`, headed by the folder basename
  // with the full path as muted subtext and a distinct local-folder icon.
  const sortedGroups = groupConfigs(configs)

  const newPreset = (
    <Button size="sm" onClick={() => openForm({ kind: "new" })}>
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
              A preset remembers how to run a project:{" "}
              {isLocalBuild
                ? "its setup and run scripts, and the files to copy from your checkout."
                : "its setup and run scripts, port and environment variables."}{" "}
              Add the project to any canvas and its workspaces start from it.
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
                    icon={
                      group.kind === "path"
                        ? FolderOpen
                        : group.private
                          ? FolderLock
                          : Folder
                    }
                    title={
                      <>
                        {group.heading}
                        {presetLabel(config) && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            {presetLabel(config)}
                          </span>
                        )}
                      </>
                    }
                    detail={<PresetDetail config={config} group={group} />}
                    action={
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            openForm({ kind: "duplicate", config })
                          }
                        >
                          <Copy className="size-3.5" />
                          <span className="sr-only">Duplicate</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openForm({ kind: "edit", config })}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setPendingDelete(config)}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete</span>
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
          if (!open) requestCloseForm()
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle>
              {mode.kind !== "list" && DIALOG_TITLE[mode.kind]}
            </DialogTitle>
            <DialogDescription>
              Applied when you add this project to a canvas.
            </DialogDescription>
          </DialogHeader>
          {mode.kind !== "list" && (
            <RepoConfigForm
              // A fresh form per open, so switching presets never carries
              // one's edits into another.
              key={
                mode.kind === "new" ? "new" : `${mode.kind}:${mode.config.id}`
              }
              initial={mode.kind === "edit" ? mode.config : undefined}
              template={
                mode.kind === "duplicate"
                  ? {
                      ...mode.config,
                      name: duplicateName(mode.config, configs),
                    }
                  : undefined
              }
              existingConfigs={configs}
              onDirtyChange={(dirty) => {
                formDirty.current = dirty
              }}
              onSaved={(updated) => {
                setConfigs(updated)
                closeForm()
              }}
              onCancel={requestCloseForm}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        verb="Discard"
        itemNoun="changes"
        cancelLabel="Keep editing"
        description="Your edits to this preset haven’t been saved."
        onConfirm={closeForm}
      />

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
 * The preset's own name beside its project heading, only when it tells the
 * row apart: a default preset, or one named after its repo, would just repeat
 * the heading (#784).
 */
function presetLabel(config: RepoConfig): string | null {
  const name = config.name.trim()
  if (!name || name === config.repoName || name === "default") return null
  return name
}

/**
 * A preset row's detail line (#784): what the preset sets — its scripts in
 * mono, then the port and env var count (web) or copied files (desktop) — and,
 * for a remote-less folder, the full path its heading abbreviates.
 */
function PresetDetail({
  config,
  group,
}: {
  config: RepoConfig
  group: ConfigGroup
}) {
  const { commands, copies, facts } = presetSummary(config, isLocalBuild)
  // Literal values (scripts, file patterns) are mono; the words around them
  // stay in the row's own type.
  const code = (text: string) => (
    <code className="font-mono text-xs">{text}</code>
  )
  const parts: React.ReactNode[] = [
    ...(commands.length ? commands.map(code) : ["No scripts set"]),
    copies.length > 0 && (
      <>
        copies{" "}
        {copies.map((pattern, i) => (
          <span key={pattern}>
            {i > 0 && ", "}
            {code(pattern)}
          </span>
        ))}
      </>
    ),
    ...facts,
    group.subtext,
  ].filter(Boolean)
  return (
    <span className="block truncate">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="mx-1.5" aria-hidden>
              ·
            </span>
          )}
          {part}
        </span>
      ))}
    </span>
  )
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
