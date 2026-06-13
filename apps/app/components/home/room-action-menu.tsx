"use client"

import { FolderInput, LogOut, Pencil, Share2, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { isLocalBuild } from "@/lib/local-mode"
import type { RoomSummary } from "@/lib/rooms-actions"

type Props = {
  room: RoomSummary
  children: React.ReactNode
  onRename: () => void
  /** Opens the delete/leave confirm — the rule resolves which one applies. */
  onDelete: () => void
  onShare: () => void
  /**
   * Opens the "Move to…" folder picker. Filing a Room is per-user, so this is
   * offered to collaborators too, not just the owner — moving a shared Room only
   * changes where the mover sees it. Omitted outside a folder view (Recents),
   * where it hides.
   */
  onMove?: () => void
}

export function RoomActionMenu({
  room,
  children,
  onRename,
  onDelete,
  onShare,
  onMove,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {room.isOwner && (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {/* Sharing is excluded from the local build (PRD #404, issue #417). */}
        {room.isOwner && !isLocalBuild && (
          <DropdownMenuItem onSelect={onShare}>
            <Share2 />
            Share
          </DropdownMenuItem>
        )}
        {onMove && (
          <DropdownMenuItem onSelect={onMove}>
            <FolderInput />
            Move to…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {room.isOwner ? (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        ) : (
          // A shared Room the user doesn't own: they leave it rather than
          // destroy it for the owner and other collaborators.
          <DropdownMenuItem onSelect={onDelete}>
            <LogOut />
            Leave
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
