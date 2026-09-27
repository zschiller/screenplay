"use client"

import { useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Switch } from "@workspace/ui/components/switch"
import { Label } from "@workspace/ui/components/label"

type DeleteRepoDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoName: string
  branches: string[]
  onConfirm: (options: { deleteBranchesOnRemote: boolean }) => Promise<void>
}

/** Confirm removing a Project (a Repo) and all of its Workspaces from the canvas. */
export function DeleteRepoDialog({
  open,
  onOpenChange,
  repoName,
  branches,
  onConfirm,
}: DeleteRepoDialogProps) {
  const [deleteBranchesOnRemote, setDeleteBranchesOnRemote] = useState(true)

  // Reset the option when the dialog closes, so reopening starts from the
  // default. The previous-prop pattern rather than an effect (see react.dev
  // "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setDeleteBranchesOnRemote(true)
  }

  const branchCount = branches.length

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb="Remove"
      itemName={repoName}
      itemNoun="project"
      description="This project and all of its workspaces will be removed from this canvas."
      onConfirm={() => onConfirm({ deleteBranchesOnRemote })}
    >
      {({ pending }) =>
        branchCount > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label
                htmlFor="delete-branches-on-remote"
                className="flex flex-col gap-1"
              >
                <span className="text-sm font-medium">
                  Also delete {branchCount}{" "}
                  {branchCount === 1 ? "branch" : "branches"} on remote
                </span>
                <span className="text-xs text-muted-foreground">
                  Permanently deletes the listed branches from origin.
                </span>
              </Label>
              <Switch
                id="delete-branches-on-remote"
                checked={deleteBranchesOnRemote}
                onCheckedChange={setDeleteBranchesOnRemote}
                disabled={pending}
              />
            </div>
            <ul className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
              {branches.map((b) => (
                <li key={b} className="truncate text-muted-foreground">
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </ConfirmDialog>
  )
}
