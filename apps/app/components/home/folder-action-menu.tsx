"use client"

import { Pencil, Trash2 } from "lucide-react"
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
  onDelete: () => void
}

export function FolderActionMenu({ children, onRename, onDelete }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          Rename
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
