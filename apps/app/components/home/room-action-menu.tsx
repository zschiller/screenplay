"use client"

import {
  FolderInput,
  LogOut,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react"
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
  /** Whether this Room is pinned — flips the toggle label and icon. */
  pinned: boolean
  /**
   * Pin the Room when unpinned, unpin it when pinned. Per-user, so it's offered
   * to collaborators too — pinning a shared Room only touches the mover's
   * sidebar (PRD #507).
   */
  onTogglePin: () => void
}

export function RoomActionMenu({
  room,
  children,
  onRename,
  onDelete,
  onShare,
  onMove,
  pinned,
  onTogglePin,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
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
        {/* Pinning is per-user and needs no ownership, so it's always offered —
            owner or collaborator, Recents or a folder view. */}
        <DropdownMenuItem onSelect={onTogglePin}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? "Unpin" : "Pin to sidebar"}
        </DropdownMenuItem>
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
