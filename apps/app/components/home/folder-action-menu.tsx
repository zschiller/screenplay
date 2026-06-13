"use client"

import { FolderInput, Pencil, Pin, PinOff, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

// The ⋮ menu for a folder tile/row, mirroring `RoomActionMenu`. Folders are
// per-user — the caller always owns the ones they can see (PRD #475) — so there
// is no owner gate here; every item applies. Delete cascades the whole branch
// behind a confirm (#488); the menu just opens it.
type Props = {
  children: React.ReactNode
  onRename: () => void
  /** Opens the "Move to…" folder picker to re-parent this folder. */
  onMove: () => void
  onDelete: () => void
  /** Whether this Folder is pinned — flips the toggle label and icon. */
  pinned: boolean
  /**
   * Pin the Folder when unpinned, unpin it when pinned. Per-user, and a pure
   * shortcut — it never moves the Folder in the tree (PRD #507).
   */
  onTogglePin: () => void
}

export function FolderActionMenu({
  children,
  onRename,
  onMove,
  onDelete,
  pinned,
  onTogglePin,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMove}>
          <FolderInput />
          Move to…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onTogglePin}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? "Unpin" : "Pin to sidebar"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
