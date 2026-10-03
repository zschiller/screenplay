"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"

// The confirm for deleting a Folder and everything beneath it (PRD #475, #488).
// Deleting a Folder is always destructive — it permanently deletes the owned
// canvases in the branch — so unlike a single shared Room there's no "leave"
// framing here; the body just names the blast radius. The counts come from the
// pure cascade collector, so the dialog stays a presentational view of them.
type DeleteFolderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  folderName: string
  /** Canvases in the branch permanently deleted (the owned Rooms torn down). */
  deletedCount: number
  /** How many of those are shared Rooms the user owns (deleted for everyone). */
  sharedOwnedCount: number
  /** Total *other* people across those shared owned Rooms. */
  sharedWithCount: number
  onConfirm: () => Promise<void>
}

function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`
}

/**
 * The confirm body, derived purely from the cascade counts. An empty branch
 * reads as a plain folder delete; a branch with canvases names how many are
 * permanently deleted; and if any of those are shared Rooms the user owns, it
 * adds that they'll be deleted for everyone they're shared with (always absent
 * on the local build, which has no sharing).
 */
function describeDeletion(
  deletedCount: number,
  sharedOwnedCount: number,
  sharedWithCount: number
): string {
  if (deletedCount === 0) {
    return (
      "This folder and all of its subfolders will be deleted. " +
      "You can't undo this."
    )
  }

  let body =
    `Deleting this folder permanently deletes ${countOf(deletedCount, "canvas", "canvases")}, ` +
    "along with all of their subfolders and contents. You can't undo this."

  if (sharedOwnedCount > 0) {
    body +=
      ` ${countOf(sharedOwnedCount, "canvas", "canvases")} ` +
      (sharedOwnedCount === 1 ? "is" : "are") +
      ` shared and will be deleted for everyone ${
        sharedOwnedCount === 1 ? "it's" : "they're"
      } shared with (${countOf(sharedWithCount, "person", "people")}).`
  }

  return body
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderName,
  deletedCount,
  sharedOwnedCount,
  sharedWithCount,
  onConfirm,
}: DeleteFolderDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb="Delete"
      itemName={folderName}
      itemNoun="folder"
      description={describeDeletion(
        deletedCount,
        sharedOwnedCount,
        sharedWithCount
      )}
      onConfirm={onConfirm}
    />
  )
}
