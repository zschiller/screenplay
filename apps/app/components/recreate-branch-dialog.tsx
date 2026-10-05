"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"

type RecreateBranchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  /**
   * The Workspace's display title, used in the dialog title so Recreate names
   * the Workspace the same way Delete does. The body keeps the git branch.
   */
  workspaceTitle?: string
  /** Runs the recreation; throws with the failure to show it inline. */
  onConfirm: () => Promise<void>
}

/**
 * Confirms the destructive "Set up again…" (the Recreate path). It reclones
 * the repo fresh from git, so any uncommitted changes in the sandbox are
 * discarded — the one recovery that destroys work, which is why it's gated
 * behind an explicit confirm rather than running on click (see ADR 0005).
 *
 * Confirming keeps the dialog open with a pending "Setting up again…" state
 * until the recreation settles; a failure shows inline so the user can retry
 * or cancel. Progress also shows on the Workspace in the sidebar (status), the
 * same way the other recovery actions report. The non-destructive alternative
 * it points at is "Restart preview", on both builds.
 */
export function RecreateBranchDialog({
  open,
  onOpenChange,
  branchName,
  workspaceTitle,
  onConfirm,
}: RecreateBranchDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb="Set up again"
      title={`Set up “${workspaceTitle ?? branchName}” again?`}
      itemNoun="chat"
      pendingLabel="Setting up again…"
      description={
        <>
          This rebuilds the chat’s code from its last push. Changes that weren’t
          pushed are <strong>permanently discarded</strong>. If the preview is
          only stuck, “Restart preview” keeps them.
        </>
      }
      onConfirm={onConfirm}
    />
  )
}
