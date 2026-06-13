"use client"

import { useState } from "react"
import Link from "next/link"
import { Folder as FolderIcon, MoreHorizontal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { FolderActionMenu } from "./folder-action-menu"
import { InputDialog } from "./input-dialog"
import { MoveToDialog } from "./move-to-dialog"
import { useFolderDragDrop } from "./file-dnd"
import { DeleteFolderDialog } from "@/components/delete-folder-dialog"
import { useHome } from "./home-provider"
import type { FolderSummary } from "@/lib/folders-actions"

// Compact folder tiles for the grid view (PRD #475): folder icon + name, no
// thumbnail, sitting in their own section above the canvas cards. The icon+name
// is a link that navigates into the folder (`/files/<id>`); the ⋮ menu (a
// sibling, since an anchor can't wrap a button) renames it in place (#484).
function FolderCard({ folder }: { folder: FolderSummary }) {
  const {
    renameFolder,
    moveFolder,
    allFolders,
    previewFolderDeletion,
    removeFolder,
  } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Both a drag source (file it elsewhere) and a drop target (file things into
  // it). `isOver` lights the tile while a valid drag hovers; `isDragging` fades
  // the lifted tile, leaving the DragOverlay as the moving preview.
  const { setNodeRef, attributes, listeners, isDragging, isOver } =
    useFolderDragDrop(folder)

  // Enumerate the cascade only while the confirm is open, from the live tree.
  const cascade = deleteOpen ? previewFolderDeletion(folder.id) : null

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn(
        "group flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 transition-colors",
        isOver
          ? "border-primary ring-2 ring-primary"
          : "border-border hover:border-foreground/20"
      )}
    >
      <Link
        href={`/files/${folder.id}`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{folder.name}</span>
      </Link>
      <FolderActionMenu
        onRename={() => setRenameOpen(true)}
        onMove={() => setMoveOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label="Folder actions"
        >
          <MoreHorizontal />
        </Button>
      </FolderActionMenu>

      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename folder"
        initialValue={folder.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFolder(folder.id, name)}
      />
      <MoveToDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        itemName={folder.name}
        currentParentId={folder.parentFolderId}
        movingFolderId={folder.id}
        folders={allFolders}
        onMove={(target) => moveFolder(folder.id, target)}
      />
      <DeleteFolderDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        folderName={folder.name}
        deletedCount={cascade?.deletedCount ?? 0}
        sharedOwnedCount={cascade?.sharedOwnedCount ?? 0}
        sharedWithCount={cascade?.sharedWithCount ?? 0}
        onConfirm={async () => {
          await removeFolder(folder.id)
          setDeleteOpen(false)
        }}
      />
    </div>
  )
}

export function FolderGrid({ folders }: { folders: FolderSummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} />
      ))}
    </div>
  )
}
