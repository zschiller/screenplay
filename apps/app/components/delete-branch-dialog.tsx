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
  onConfirm: (options: { deleteOnRemote: boolean }) => Promise<void>
}

export function DeleteBranchDialog({
  open,
  onOpenChange,
  branchName,
  onConfirm,
}: DeleteBranchDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOnRemote, setDeleteOnRemote] = useState(true)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setDeleting(false)
      setError(null)
      setDeleteOnRemote(true)
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
          <AlertDialogTitle>Delete branch?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent and its frames will be removed. The local branch{" "}
            <span className="font-mono">{branchName}</span> stays in your
            sandbox unless you also delete it on the remote.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
                await onConfirm({ deleteOnRemote })
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
