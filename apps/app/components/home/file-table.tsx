"use client"

import { useState } from "react"
import { File as FileIcon, MoreHorizontal, Pin } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { formatDistanceToNow } from "@/lib/utils"
import { DRAFTS_FOLDER_ID } from "@/lib/organization"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { FileActionMenu } from "./file-action-menu"
import { InputDialog } from "./file-dialogs"
import { useHome } from "./home-provider"
import type { RoomSummary } from "@/lib/rooms-actions"

function FileRow({ file }: { file: RoomSummary }) {
  const { renameFile, removeFile, pinnedFiles, folders, fileFolder } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const pinned = pinnedFiles.has(file.id)
  const folderId = fileFolder[file.id] ?? DRAFTS_FOLDER_ID
  const folderName =
    folderId === DRAFTS_FOLDER_ID
      ? "Drafts"
      : (folders.find((f) => f.id === folderId)?.name ?? "Folder")

  return (
    <TableRow className="group">
      <TableCell className="w-full">
        <a href={`/${file.id}`} className="flex items-center gap-2">
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium hover:underline">
            {file.name}
          </span>
          {pinned && (
            <Pin className="size-3 shrink-0 fill-foreground/60 text-foreground/60" />
          )}
        </a>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {folderName}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDistanceToNow(file.lastConnectionAt ?? file.createdAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDistanceToNow(file.createdAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {file.isOwner ? "You" : "Shared"}
      </TableCell>
      <TableCell className="w-8 pr-2">
        <FileActionMenu
          file={file}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onShare={() => setShareOpen(true)}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="File actions"
          >
            <MoreHorizontal />
          </Button>
        </FileActionMenu>
      </TableCell>

      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename file"
        initialValue={file.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFile(file.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareRoomDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          roomId={file.id}
          roomName={file.name}
        />
      )}
    </TableRow>
  )
}

export function FileTable({ files }: { files: RoomSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Folder</TableHead>
          <TableHead>Last edited</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <FileRow key={file.id} file={file} />
        ))}
      </TableBody>
    </Table>
  )
}
