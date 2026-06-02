"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { buttonVariants } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"
import { Label } from "@workspace/ui/components/label"

type DeleteRepoDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoName: string
  branches: string[]
  onConfirm: (options: { deleteBranchesOnRemote: boolean }) => Promise<void>
}

export function DeleteRepoDialog({
  open,
  onOpenChange,
  repoName,
  branches,
  onConfirm,
}: DeleteRepoDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteBranchesOnRemote, setDeleteBranchesOnRemote] = useState(true)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setDeleting(false)
      setError(null)
      setDeleteBranchesOnRemote(true)
    }
  }

  const branchCount = branches.length

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono">{repoName}</span> and all of its agents
            will be removed from this canvas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {branchCount > 0 && (
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
                disabled={deleting}
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
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={deleting}
            onClick={async (event) => {
              event.preventDefault()
              setDeleting(true)
              setError(null)
              try {
                await onConfirm({ deleteBranchesOnRemote })
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to remove workspace"
                )
                setDeleting(false)
              }
            }}
          >
            {deleting ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
