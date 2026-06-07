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

type RecreateBranchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  onConfirm: () => Promise<void>
}

/**
 * Confirms the destructive "Recreate from scratch" sandbox action. Recreating
 * reclones the repo fresh from git, so any uncommitted changes in the sandbox
 * are discarded — this is the one restart that destroys work, which is why it's
 * gated behind an explicit confirm rather than running on click (see ADR 0005).
 */
export function RecreateBranchDialog({
  open,
  onOpenChange,
  branchName,
  onConfirm,
}: RecreateBranchDialogProps) {
  const [recreating, setRecreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setRecreating(false)
      setError(null)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (recreating) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recreate from scratch?</AlertDialogTitle>
          <AlertDialogDescription>
            This recreates the sandbox for{" "}
            <span className="font-mono">{branchName}</span> by cloning the
            branch fresh from git. Any uncommitted changes in the sandbox will
            be <strong>permanently discarded</strong>. To restart while keeping
            your working tree, use “Restart sandbox” instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={recreating}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={recreating}
            onClick={async (event) => {
              event.preventDefault()
              setRecreating(true)
              setError(null)
              try {
                await onConfirm()
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to recreate sandbox"
                )
                setRecreating(false)
              }
            }}
          >
            {recreating ? "Recreating…" : "Recreate from scratch"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
