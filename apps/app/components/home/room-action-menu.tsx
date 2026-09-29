"use client"

import {
  FolderSimpleIcon,
  PencilSimpleIcon,
  PushPinIcon,
  PushPinSlashIcon,
  ShareNetworkIcon,
  SignOutIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
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
   * changes where the mover sees it. Omitted, and hidden, while the user has no
   * Folder to file into — see `canMoveRoom`, the one rule every surface uses.
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
            <PencilSimpleIcon />
            Rename
          </DropdownMenuItem>
        )}
        {/* Sharing is excluded from the local build (PRD #404, issue #417). */}
        {room.isOwner && !isLocalBuild && (
          <DropdownMenuItem onSelect={onShare}>
            <ShareNetworkIcon />
            Share
          </DropdownMenuItem>
        )}
        {onMove && (
          <DropdownMenuItem onSelect={onMove}>
            <FolderSimpleIcon />
            Move to…
          </DropdownMenuItem>
        )}
        {/* Pinning is per-user and needs no ownership, so it's always offered —
            owner or collaborator, Recents or a folder view. */}
        <DropdownMenuItem onSelect={onTogglePin}>
          {pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
          {pinned ? "Unpin" : "Pin to sidebar"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {room.isOwner ? (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        ) : (
          // A shared Room the user doesn't own: they leave it rather than
          // destroy it for the owner and other collaborators.
          <DropdownMenuItem onSelect={onDelete}>
            <SignOutIcon />
            Leave
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
