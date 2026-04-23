"use client"

import { useState } from "react"
import { MoreHorizontal, Pin } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteProjectDialog } from "@/components/delete-project-dialog"
import { ShareProjectDialog } from "@/components/share-project-dialog"
import { FileActionMenu } from "./file-action-menu"
import { InputDialog } from "./file-dialogs"
import { useHome } from "./home-provider"
import type { ProjectSummary } from "@/lib/projects-actions"

function FileCard({ file }: { file: ProjectSummary }) {
  const { renameFile, removeFile, pinnedFiles } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const pinned = pinnedFiles.has(file.id)

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-foreground/20">
      <a
        href={`/${file.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-[4/3] w-full bg-gradient-to-br from-muted to-muted/40"
        aria-label={`Open ${file.name}`}
      />
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <a
            href={`/${file.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium hover:underline"
          >
            {file.name}
          </a>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Edited {formatDistanceToNow(file.lastConnectionAt ?? file.createdAt)}</span>
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
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareProjectDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={file.id}
          projectName={file.name}
        />
      )}
    </div>
  )
}

export function FileGrid({ files }: { files: ProjectSummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {files.map((file) => (
        <FileCard key={file.id} file={file} />
      ))}
    </div>
  )
}
