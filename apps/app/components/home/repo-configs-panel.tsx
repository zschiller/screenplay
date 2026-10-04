"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  CopyIcon,
  DotsThreeIcon,
  FolderIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent } from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  AddRepositoryDialog,
  NewRepositoryButton,
  useAddRepositoryFlow,
} from "@/components/add-repository-dialog"
import { LoadErrorRow } from "@/components/home/load-error"
import { RepoConfigForm } from "@/components/home/repo-config-form"
import {
  REPO_DIALOG_CONTENT,
  RepoDialogHeader,
} from "@/components/repo-dialog-layout"
import { RepoTitle } from "@/components/repo-title"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "@/components/home/settings-row"
import {
  deleteRepository,
  listRepositories,
  repositoryCanvasCount,
  repositoryCanvasCounts,
} from "@/lib/repository-library/actions"
import {
  repositoryLinkPolicy,
  type RepositoryLinkPolicy,
} from "@/lib/repository-library/link-policy"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { duplicateName, presetSummary } from "@/lib/preset-summary"
import { isLocalBuild } from "@/lib/local-mode"
import { ConfirmDialog } from "@/components/confirm-dialog"

type Mode =
  | { kind: "list" }
  | { kind: "edit"; config: RepoConfig }
  | { kind: "duplicate"; config: RepoConfig }

const DIALOG_TITLE: Record<Exclude<Mode["kind"], "list">, string> = {
  edit: "Edit repository",
  duplicate: "Duplicate repository",
}

/**
 * Manages your Repositories (per-repo setup/dev/port/env), one settings row
 * each, sorted by project. Lives on the Settings page. New repository opens the
 * same picker and detected settings form as a Canvas's, and only saves
 * (#1423); edit/duplicate open the form in a dialog over the list, so the
 * editor never nests a scroll area inside the page's own scroll.
 */
export function RepoConfigsPanel({
  header,
  policy = repositoryLinkPolicy,
}: {
  /** The Settings section's title row; New repository sits on its right (#927). */
  header: (action?: React.ReactNode) => React.ReactNode
  /** Whether Canvas Repos follow their Repository; this build's unless a
   *  test picks one. */
  policy?: RepositoryLinkPolicy
}) {
  const [configs, setConfigs] = useState<RepoConfig[]>([])
  // How many canvases follow each Repository (desktop), so a row says whether
  // Edit reaches canvases (H5). Loaded with the list, so rows never jump.
  const [canvasCounts, setCanvasCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  // The Repository awaiting delete confirmation, with how many Canvases use
  // it (`null` when that couldn't be read); the confirm owns pending + error.
  const [pendingDelete, setPendingDelete] = useState<{
    config: RepoConfig
    canvases: number | null
  } | null>(null)
  // Whether the open form differs from what it opened with; closing a changed
  // form asks first (#784). A ref, since only the close path reads it.
  const formDirty = useRef(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const addRepository = useAddRepositoryFlow()

  useEffect(() => {
    let cancelled = false
    Promise.all([listRepositories(), loadCanvasCounts(policy)])
      .then(([list, counts]) => {
        if (cancelled) return
        setConfigs(list)
        setCanvasCounts(counts)
      })
      .catch((err) => {
        console.error("Failed to load repositories", err)
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [policy])

  // Retry after a failed load; a second failure rejects and leaves the error up.
  const reload = useCallback(async () => {
    const [list, counts] = await Promise.all([
      listRepositories(),
      loadCanvasCounts(policy),
    ])
    setConfigs(list)
    setCanvasCounts(counts)
    setLoadFailed(false)
  }, [policy])

  // The count comes first, so the confirm opens with its final wording. A
  // canvas whose copy never took your edits (hosted, #1427) isn't counted.
  const requestDelete = async (config: RepoConfig) => {
    if (!policy.deleteUnlinksCanvases) {
      setPendingDelete({ config, canvases: null })
      return
    }
    const canvases = await repositoryCanvasCount(config.id).catch((err) => {
      console.error("Failed to count canvases using repository", err)
      return null
    })
    setPendingDelete({ config, canvases })
  }

  const handleDelete = async (id: string) => {
    const updated = await deleteRepository(id)
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
  // with the full path in its facts line.
  const sortedGroups = groupConfigs(configs)

  const newRepository = (variant: "default" | "outline") => (
    <NewRepositoryButton flow={addRepository} variant={variant} />
  )

  // With repositories listed, New repository sits on the section's title row. The empty
  // state offers it as its own call to action instead, so it shows once.
  const hasList = !loading && !loadFailed && configs.length > 0

  return (
    <>
      {header(hasList ? newRepository("outline") : undefined)}
      <div className="flex min-w-0 flex-col gap-3">
        {loading ? (
          <SettingsRowSkeleton label="Loading repositories…" count={2} />
        ) : loadFailed ? (
          <LoadErrorRow title="Couldn’t load repositories" onRetry={reload} />
        ) : configs.length === 0 ? (
          <Empty className="border py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon />
              </EmptyMedia>
              <EmptyTitle>No repositories yet</EmptyTitle>
              <EmptyDescription>
                Each repository remembers how it runs:{" "}
                {isLocalBuild
                  ? "its setup and run scripts, and the files to copy from your checkout."
                  : "its setup and run scripts, port and environment variables."}{" "}
                Add the repository to any canvas and its workspaces start from
                it.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{newRepository("default")}</EmptyContent>
          </Empty>
        ) : (
          <SettingsRowList>
            {sortedGroups.flatMap((group) =>
              group.items
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((config) => (
                  <SettingsRow
                    key={config.id}
                    title={<RepoTitle repo={config} />}
                    marker={
                      canvasCounts[config.id] ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {canvasCountLabel(canvasCounts[config.id]!)}
                        </span>
                      ) : undefined
                    }
                    state={group.private ? "Private" : undefined}
                    detail={<PresetDetail config={config} group={group} />}
                    action={
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openForm({ kind: "edit", config })}
                        >
                          Edit
                        </Button>
                        {/* Edit is the common action; the rest go in a menu
                            so the row keeps one visible button (#784). */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              aria-label="More actions"
                            >
                              <DotsThreeIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            // Both items open a dialog; handing focus back to
                            // the trigger would pull it out of that dialog.
                            onCloseAutoFocus={(event) => event.preventDefault()}
                          >
                            <DropdownMenuItem
                              onSelect={() =>
                                openForm({ kind: "duplicate", config })
                              }
                            >
                              <CopyIcon />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void requestDelete(config)}
                            >
                              <TrashIcon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                  />
                ))
            )}
          </SettingsRowList>
        )}

        <Dialog
          open={mode.kind !== "list"}
          onOpenChange={(open) => {
            if (!open) requestCloseForm()
          }}
        >
          <DialogContent
            // With a source already set (Edit, Duplicate), start in the name
            // field rather than on Change, the dialog's first control.
            onOpenAutoFocus={(event) => {
              const name = (
                event.currentTarget as HTMLElement
              ).querySelector<HTMLInputElement>("#config-name")
              if (!name) return
              event.preventDefault()
              name.focus()
            }}
            className={REPO_DIALOG_CONTENT}
          >
            <RepoDialogHeader
              title={mode.kind !== "list" && DIALOG_TITLE[mode.kind]}
              description={
                policy.propagatesEdits
                  ? "A repository’s scripts. Saving updates every canvas that uses it, unless it’s customized there."
                  : "A repository’s scripts, applied when you add it to a canvas."
              }
              source={mode.kind !== "list" ? mode.config.repoFullName : ""}
            />
            {mode.kind !== "list" && (
              <RepoConfigForm
                // A fresh form per open, so switching presets never carries
                // one's edits into another.
                key={`${mode.kind}:${mode.config.id}`}
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

        <AddRepositoryDialog
          flow={addRepository}
          onAdded={(_, list) => setConfigs(list)}
        />

        <ConfirmDialog
          open={confirmDiscard}
          onOpenChange={setConfirmDiscard}
          verb="Discard"
          itemNoun="changes"
          cancelLabel="Keep editing"
          description="Your edits to this repository haven’t been saved."
          onConfirm={closeForm}
        />

        <ConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
          verb="Delete"
          itemName={pendingDelete?.config.name}
          itemNoun="repository"
          description={
            pendingDelete
              ? deleteDescription(policy, pendingDelete.canvases)
              : null
          }
          onConfirm={() => handleDelete(pendingDelete!.config.id)}
        />
      </div>
    </>
  )
}

/** Each Repository's canvas count where canvases follow it; elsewhere (and
 *  when the count can't be read) none, so rows simply say nothing. */
async function loadCanvasCounts(
  policy: RepositoryLinkPolicy
): Promise<Record<string, number>> {
  if (!policy.deleteUnlinksCanvases) return {}
  return repositoryCanvasCounts().catch((err) => {
    console.error("Failed to count canvases using repositories", err)
    return {}
  })
}

function canvasCountLabel(count: number): string {
  return count === 1 ? "On 1 canvas" : `On ${count} canvases`
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

/** The delete confirm's body: Canvases that use the Repository keep their
 *  copy, unlinked (#1426). `null` = the count couldn't be read. Where a
 *  canvas's copy is its own (hosted, #1427), deleting changes nothing there. */
function deleteDescription(
  policy: RepositoryLinkPolicy,
  canvases: number | null
): string {
  if (!policy.deleteUnlinksCanvases)
    return "Canvases that use it keep their own copy."
  const keeps = "but it stops getting your edits."
  if (canvases === null) return `Canvases using it keep their copy, ${keeps}`
  if (canvases === 0) return "It isn’t on any canvas."
  if (canvases === 1)
    return `It’s on 1 canvas. That canvas keeps its copy, ${keeps}`
  return `It’s on ${canvases} canvases. They keep their copy, ${keeps}`
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
