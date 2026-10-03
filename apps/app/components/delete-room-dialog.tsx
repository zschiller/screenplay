"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"

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
  verb: "Leave" | "Delete"
  description: string
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
      verb: "Leave",
      description:
        "You’ll be removed from this shared canvas. Everyone else keeps " +
        "their access, and the owner can re-invite you.",
      destructive: false,
    }
  }
  if (sharedWithCount > 0) {
    return {
      verb: "Delete",
      description:
        `This canvas is shared with ${peopleCount(sharedWithCount)}. ` +
        "Deleting it permanently removes it for everyone, along with all of " +
        "its contents. You can't undo this.",
      destructive: true,
    }
  }
  return {
    verb: "Delete",
    description:
      "This canvas and all of its contents will be permanently deleted. " +
      "You can't undo this.",
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
  const framing = framingFor(isOwner, sharedWithCount)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb={framing.verb}
      itemName={roomName}
      itemNoun="canvas"
      description={framing.description}
      destructive={framing.destructive}
      onConfirm={onConfirm}
    />
  )
}
