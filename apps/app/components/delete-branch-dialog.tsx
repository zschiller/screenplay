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

type DeleteBranchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  /**
   * Whether deleting the branch on the remote is something this Project could
   * actually do: a GitHub API token resolves *and* the Project has a GitHub
   * remote to name. False hides the toggle outright rather than disabling it —
   * an offer that can only fail is worse than no offer (issue #741).
   */
  canDeleteOnRemote: boolean
  onConfirm: (options: { deleteOnRemote: boolean }) => Promise<void>
}

/**
 * Confirm deleting a Workspace (a Branch), optionally taking its branch off the
 * GitHub remote with it.
 *
 * The remote delete is strictly opt-in: it defaults **off** and is only offered
 * when it could succeed (`canDeleteOnRemote`). It used to default on, which on
 * the desktop build — where GitHub API access is optional by design (the no-auth
 * floor, ADR 0008) — meant the common path failed inline with "No GitHub token"
 * and deleted nothing until the user noticed the toggle.
 */
export function DeleteBranchDialog({
  open,
  onOpenChange,
  branchName,
  canDeleteOnRemote,
  onConfirm,
}: DeleteBranchDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOnRemote, setDeleteOnRemote] = useState(false)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setDeleting(false)
      setError(null)
      setDeleteOnRemote(false)
    }
  }

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
          <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent and its frames will be removed. The local branch{" "}
            <span className="font-mono">{branchName}</span> stays in your
            sandbox
            {canDeleteOnRemote
              ? " unless you also delete it on the remote."
              : "."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {canDeleteOnRemote && (
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="delete-on-remote" className="flex flex-col gap-1">
              <span className="text-sm font-medium">Also delete on remote</span>
              <span className="text-xs text-muted-foreground">
                origin/<span className="font-mono">{branchName}</span>
              </span>
            </Label>
            <Switch
              id="delete-on-remote"
              checked={deleteOnRemote}
              onCheckedChange={setDeleteOnRemote}
              disabled={deleting}
            />
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
                // Never ask for a remote delete the dialog didn't offer: the
                // toggle's state is unreachable while it's hidden.
                await onConfirm({
                  deleteOnRemote: canDeleteOnRemote && deleteOnRemote,
                })
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Failed to delete branch"
                )
                setDeleting(false)
              }
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
