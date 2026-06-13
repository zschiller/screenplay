"use client"

import { Pencil } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

// The ⋮ menu for a folder tile/row, mirroring `RoomActionMenu`. Folders are
// per-user — the caller always owns the ones they can see (PRD #475) — so there
// is no owner gate here; every item applies. Rename is the only action for now;
// delete lands in a later slice.
type Props = {
  children: React.ReactNode
  onRename: () => void
}

export function FolderActionMenu({ children, onRename }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
