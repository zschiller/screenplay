"use client"

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
import { isLocalBuild } from "@/lib/local-mode"

type RecreateBranchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  onConfirm: () => void
}

/**
 * Confirms the destructive "Recreate from scratch" sandbox action. Recreating
 * reclones the repo fresh from git, so any uncommitted changes in the sandbox
 * are discarded — this is the one restart that destroys work, which is why it's
 * gated behind an explicit confirm rather than running on click (see ADR 0005).
 *
 * Confirming closes the dialog immediately and fires the recreation; progress
 * and any failure surface on the branch in the sidebar (status + toast), the
 * same way the other restart actions report — so the dialog never blocks on the
 * work.
 *
 * The "keep your working tree" pointer is build-aware: hosted has a VM cycle
 * ("Restart sandbox") that preserves the tree, but the local backend has no VM,
 * so its non-destructive restart is "Restart dev server" instead.
 */
export function RecreateBranchDialog({
  open,
  onOpenChange,
  branchName,
  onConfirm,
}: RecreateBranchDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recreate from scratch?</AlertDialogTitle>
          <AlertDialogDescription>
            This recreates the sandbox for{" "}
            <span className="font-mono">{branchName}</span> by cloning the
            branch fresh from git. Any uncommitted changes in the sandbox will
            be <strong>permanently discarded</strong>. To restart while keeping
            your working tree, use{" "}
            “{isLocalBuild ? "Restart dev server" : "Restart sandbox"}” instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onConfirm}
          >
            Recreate from scratch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
