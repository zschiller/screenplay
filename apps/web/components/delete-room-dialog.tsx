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
  onConfirm: () => Promise<void>
}

export function DeleteRoomDialog({
  open,
  onOpenChange,
  roomName,
  onConfirm,
}: DeleteRoomDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset transient state when the dialog is dismissed, so reopening starts
  // clean. Done during render via the previous-prop pattern rather than in an
  // effect (see react.dev "You Might Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setDeleting(false)
      setError(null)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return
        onOpenChange(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{roomName}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This project and all of its contents will be permanently deleted.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
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
                await onConfirm()
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to delete project"
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
