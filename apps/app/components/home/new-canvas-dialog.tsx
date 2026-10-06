"use client"

import { useEffect, useId, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { RepoTitle } from "@/components/repo-title"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { listRepositories } from "@/lib/repository-library/actions"
import type { RoomSummary } from "@/lib/rooms-actions"
import { useCreateCanvas } from "./use-create-canvas"

/** Your Repositories as last listed, so reopening the dialog shows them at
 *  once while they're listed again. */
let lastRepositories: RepoConfig[] | null = null

/**
 * New canvas (#1812): name the Canvas and tick the Repositories it works on,
 * then open it with them switched on. Every New canvas on home opens this,
 * with the folder the Canvas goes into. Repositories are optional, and a
 * blank Name makes “Untitled”.
 */
export function NewCanvasDialog({
  open,
  onOpenChange,
  folderId,
  createRoom,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The folder to file it into; omitted = the folder you're viewing. */
  folderId?: string | null
  createRoom: (
    name: string,
    folderId?: string | null,
    repositoryIds?: string[]
  ) => Promise<RoomSummary>
}) {
  const { create, creating } = useCreateCanvas(createRoom)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (creating) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="sm:max-w-[448px]"
        // No ×, like Escape and Cancel, while the create is in flight.
        showCloseButton={!creating}
      >
        {open && (
          <NewCanvasForm
            creating={creating}
            onCancel={() => onOpenChange(false)}
            onCreate={(name, repositoryIds, onError) =>
              create({ name, repositoryIds, folderId }, onError)
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewCanvasForm({
  creating,
  onCancel,
  onCreate,
}: {
  creating: boolean
  onCancel: () => void
  onCreate: (name: string, repositoryIds: string[], onError: () => void) => void
}) {
  const id = useId()
  const [name, setName] = useState("")
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState(false)
  const repositories = useRepositories()

  const toggle = (repositoryId: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(repositoryId)
      else next.delete(repositoryId)
      return next
    })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (creating) return
    setFailed(false)
    // In the list's order, which is the order they're switched on.
    const repositoryIds = (repositories ?? [])
      .filter((r) => ticked.has(r.id))
      .map((r) => r.id)
    onCreate(name, repositoryIds, () => setFailed(true))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>New canvas</DialogTitle>
        <DialogDescription>
          Name it and pick the repositories it works on. You can change both
          later.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          autoFocus
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled"
          disabled={creating}
        />
      </div>
      <div
        role="group"
        aria-labelledby={`${id}-repositories`}
        className="flex flex-col gap-2"
      >
        <Label id={`${id}-repositories`} asChild>
          <span>Repositories</span>
        </Label>
        <RepositoryList
          idPrefix={id}
          repositories={repositories}
          ticked={ticked}
          disabled={creating}
          onToggle={toggle}
        />
      </div>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t create the canvas. Try again.
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={creating}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={creating}>
          {creating && (
            // The regular Spinner, as ConfirmDialog: plain progress.
            <Spinner aria-hidden role={undefined} aria-label={undefined} />
          )}
          Create canvas
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Your Repositories, listed each time the dialog opens; `null` until the
 *  first list arrives. A failed list shows none, as Repositories are
 *  optional. */
function useRepositories(): RepoConfig[] | null {
  const [repositories, setRepositories] = useState(lastRepositories)
  useEffect(() => {
    let cancelled = false
    listRepositories()
      .then((list) => {
        lastRepositories = list
        if (!cancelled) setRepositories(list)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setRepositories((prev) => prev ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [])
  return repositories
}

function RepositoryList({
  idPrefix,
  repositories,
  ticked,
  disabled,
  onToggle,
}: {
  idPrefix: string
  repositories: RepoConfig[] | null
  ticked: ReadonlySet<string>
  disabled: boolean
  onToggle: (repositoryId: string, on: boolean) => void
}) {
  if (repositories === null) {
    return (
      <div className="flex h-[62px] items-center justify-center rounded-lg border border-input">
        <Spinner />
      </div>
    )
  }
  if (repositories.length === 0) {
    return (
      <p className="rounded-lg border border-input px-6 py-6 text-center text-muted-foreground">
        No repositories yet. Add one to preview its code in frames, or skip it
        and start with mockups and documents.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-input rounded-lg border border-input">
      {repositories.map((repository) => {
        const checkboxId = `${idPrefix}-repository-${repository.id}`
        return (
          <li key={repository.id}>
            <label
              htmlFor={checkboxId}
              className="flex cursor-pointer items-center gap-3 px-4 py-3"
            >
              <Checkbox
                id={checkboxId}
                checked={ticked.has(repository.id)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onToggle(repository.id, checked === true)
                }
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">
                  <RepoTitle repo={repository} />
                </span>
                <RunScripts repository={repository} />
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** A row's second line: its install and run commands in mono. */
function RunScripts({ repository }: { repository: RepoConfig }) {
  const scripts = [repository.setupScript, repository.devScript]
    .map((s) => s.trim())
    .filter(Boolean)
  return (
    <span className="truncate font-mono text-xs text-muted-foreground">
      {scripts.length > 0 ? scripts.join(" · ") : "No scripts set"}
    </span>
  )
}
