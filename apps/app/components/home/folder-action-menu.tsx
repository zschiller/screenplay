"use client"

import { Pencil, Pin, PinOff, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useHome } from "./home-provider"
import type { Folder } from "@/lib/organization"

type Props = {
  folder: Folder
  children: React.ReactNode
  onRename: () => void
  onDelete: () => void
}

export function FolderActionMenu({
  folder,
  children,
  onRename,
  onDelete,
}: Props) {
  const { pinnedFolders, toggleFolderPin } = useHome()
  const pinned = pinnedFolders.has(folder.id)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => toggleFolderPin(folder.id)}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? "Unpin" : "Pin to top"}
        </DropdownMenuItem>
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
