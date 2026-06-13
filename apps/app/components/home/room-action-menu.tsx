"use client"

import { Pencil, Share2, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { isLocalBuild } from "@/lib/local-mode"
import type { RoomSummary } from "@/lib/rooms-actions"

type Props = {
  room: RoomSummary
  children: React.ReactNode
  onRename: () => void
  onDelete: () => void
  onShare: () => void
}

export function RoomActionMenu({
  room,
  children,
  onRename,
  onDelete,
  onShare,
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
        {room.isOwner && <DropdownMenuSeparator />}
        {room.isOwner && (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        )}
        {!room.isOwner && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Shared with you</DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
