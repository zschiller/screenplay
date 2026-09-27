"use client"

import { useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
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
  const [deleteOnRemote, setDeleteOnRemote] = useState(false)

  // Reset the opt-in when the dialog closes, so reopening starts local-only.
  // The previous-prop pattern rather than an effect (see react.dev "You Might
  // Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setDeleteOnRemote(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb="Delete"
      itemName={branchName}
      itemNoun="workspace"
      description={
        <>
          The agent and its frames will be removed. The local branch{" "}
          <span className="font-mono">{branchName}</span> stays in your sandbox
          {canDeleteOnRemote
            ? " unless you also delete it on the remote."
            : "."}
        </>
      }
      // Never ask for a remote delete the dialog didn't offer: the toggle's
      // state is unreachable while it's hidden.
      onConfirm={() =>
        onConfirm({ deleteOnRemote: canDeleteOnRemote && deleteOnRemote })
      }
    >
      {({ pending }) =>
        canDeleteOnRemote && (
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
              disabled={pending}
            />
          </div>
        )
      }
    </ConfirmDialog>
  )
}
