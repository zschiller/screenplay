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

type DeleteRoomDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomName: string
  /** Whether the current user owns the Room (vs. is a shared collaborator). */
  isOwner: boolean
  /** How many *other* people the Room is shared with. */
  sharedWithCount: number
  onConfirm: () => Promise<void>
}

type Framing = {
  title: string
  description: string
  confirmLabel: string
  pendingLabel: string
  errorFallback: string
  /** Permanent destruction is red; leaving a shared Room is not. */
  destructive: boolean
}

function peopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`
}

/**
 * Pick the confirm's framing from the same membership facts the Room-deletion
 * rule decides from: a non-owner *leaves*, a shared owner deletes *for
 * everyone*, and a sole owner just deletes.
 */
function framingFor(isOwner: boolean, sharedWithCount: number): Framing {
  if (!isOwner) {
    return {
      title: "Leave",
      description:
        "You’ll be removed from this shared canvas. Everyone else keeps " +
        "their access, and the owner can re-invite you.",
      confirmLabel: "Leave",
      pendingLabel: "Leaving…",
      errorFallback: "Failed to leave canvas",
      destructive: false,
    }
  }
  if (sharedWithCount > 0) {
    return {
      title: "Delete",
      description:
        `This canvas is shared with ${peopleCount(sharedWithCount)}. ` +
        "Deleting it permanently removes it for everyone, along with all of " +
        "its contents. This cannot be undone.",
      confirmLabel: "Delete",
      pendingLabel: "Deleting…",
      errorFallback: "Failed to delete project",
      destructive: true,
    }
  }
  return {
    title: "Delete",
    description:
      "This project and all of its contents will be permanently deleted. " +
      "This cannot be undone.",
    confirmLabel: "Delete",
    pendingLabel: "Deleting…",
    errorFallback: "Failed to delete project",
    destructive: true,
  }
}

export function DeleteRoomDialog({
  open,
  onOpenChange,
  roomName,
  isOwner,
  sharedWithCount,
  onConfirm,
}: DeleteRoomDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setPending(false)
      setError(null)
    }
  }

  const framing = framingFor(isOwner, sharedWithCount)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        onOpenChange(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {framing.title} &ldquo;{roomName}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription>{framing.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              framing.destructive
                ? buttonVariants({ variant: "destructive" })
                : undefined
            }
            disabled={pending}
            onClick={async (event) => {
              event.preventDefault()
              setPending(true)
              setError(null)
              try {
                await onConfirm()
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : framing.errorFallback
                )
                setPending(false)
              }
            }}
          >
            {pending ? framing.pendingLabel : framing.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
