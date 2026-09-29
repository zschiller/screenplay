"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { isLocalBuild } from "@/lib/local-mode"

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
 * Confirms the destructive "Recreate from scratch" sandbox action. Recreating
 * reclones the repo fresh from git, so any uncommitted changes in the sandbox
 * are discarded — this is the one restart that destroys work, which is why it's
 * gated behind an explicit confirm rather than running on click (see ADR 0005).
 *
 * Confirming keeps the dialog open with a pending "Recreating…" state until the
 * recreation settles; a failure shows inline so the user can retry or cancel.
 * Progress also shows on the Workspace in the sidebar (status), the same way
 * the other restart actions report.
 *
 * The "keep your working tree" pointer is build-aware: hosted has a VM cycle
 * ("Restart sandbox") that preserves the tree, but the local backend has no VM,
 * so its non-destructive restart is "Restart dev server" instead.
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
      verb="Recreate"
      itemName={workspaceTitle ?? branchName}
      itemNoun="workspace"
      description={
        <>
          This recreates the sandbox for{" "}
          <span className="font-mono">{branchName}</span> by cloning the branch
          fresh from git. Any uncommitted changes in the sandbox will be{" "}
          <strong>permanently discarded</strong>. To restart while keeping your
          working tree, use “
          {isLocalBuild ? "Restart dev server" : "Restart sandbox"}” instead.
        </>
      }
      onConfirm={onConfirm}
    />
  )
}
