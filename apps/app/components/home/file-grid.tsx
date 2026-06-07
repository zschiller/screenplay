"use client"

import { useState } from "react"
import Image from "next/image"
import { MoreHorizontal, Pin } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { FileActionMenu } from "./file-action-menu"
import { InputDialog } from "./file-dialogs"
import { useHome } from "./home-provider"
import type { RoomSummary } from "@/lib/rooms-actions"

function FileCard({ file }: { file: RoomSummary }) {
  const { renameFile, removeFile, pinnedFiles } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const pinned = pinnedFiles.has(file.id)

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-foreground/20">
      <a
        href={`/${file.id}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-muted to-muted/40"
        aria-label={`Open ${file.name}`}
      >
        {file.thumbnailUrl && (
          <Image
            key={file.thumbnailUpdatedAt ?? file.thumbnailUrl}
            src={file.thumbnailUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
            className="object-cover"
            unoptimized
          />
        )}
      </a>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <a
            href={`/${file.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {file.name}
          </a>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              Edited{" "}
              {formatDistanceToNow(file.lastConnectionAt ?? file.createdAt)}
            </span>
            {!file.isOwner && (
              <>
                <span>·</span>
                <span>Shared</span>
              </>
            )}
          </div>
        </div>
        {pinned && (
          <Pin className="size-3.5 shrink-0 fill-foreground/60 text-foreground/60" />
        )}
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
      </div>

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
    </div>
  )
}

export function FileGrid({ files }: { files: RoomSummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {files.map((file) => (
        <FileCard key={file.id} file={file} />
      ))}
    </div>
  )
}
