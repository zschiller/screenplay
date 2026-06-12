"use client"

import { FolderInput, Pencil, Pin, PinOff, Share2, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { DRAFTS_FOLDER_ID } from "@/lib/organization"
import { isLocalBuild } from "@/lib/local-mode"
import { useHome } from "./home-provider"
import type { RoomSummary } from "@/lib/rooms-actions"

type Props = {
  file: RoomSummary
  children: React.ReactNode
  onRename: () => void
  onDelete: () => void
  onShare: () => void
}

export function FileActionMenu({
  file,
  children,
  onRename,
  onDelete,
  onShare,
}: Props) {
  const { folders, fileFolder, pinnedFiles, moveFile, toggleFilePin } =
    useHome()
  const currentFolder = fileFolder[file.id] ?? DRAFTS_FOLDER_ID
  const pinned = pinnedFiles.has(file.id)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => toggleFilePin(file.id)}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? "Unpin" : "Pin to top"}
        </DropdownMenuItem>
        {file.isOwner && (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {file.isOwner && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={currentFolder}
                onValueChange={(v) => moveFile(file.id, v)}
              >
                <DropdownMenuRadioItem value={DRAFTS_FOLDER_ID}>
                  Drafts
                </DropdownMenuRadioItem>
                {folders.length > 0 && <DropdownMenuSeparator />}
                {folders.map((folder) => (
                  <DropdownMenuRadioItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {/* Sharing is excluded from the local build (PRD #404, issue #417). */}
        {file.isOwner && !isLocalBuild && (
          <DropdownMenuItem onSelect={onShare}>
            <Share2 />
            Share
          </DropdownMenuItem>
        )}
        {file.isOwner && <DropdownMenuSeparator />}
        {file.isOwner && (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        )}
        {!file.isOwner && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Shared with you</DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
