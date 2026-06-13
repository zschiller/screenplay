"use client"

import { useState } from "react"
import Link from "next/link"
import { Folder as FolderIcon, MoreHorizontal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { FolderActionMenu } from "./folder-action-menu"
import { InputDialog } from "./input-dialog"
import { useHome } from "./home-provider"
import type { FolderSummary } from "@/lib/folders-actions"

// Compact folder tiles for the grid view (PRD #475): folder icon + name, no
// thumbnail, sitting in their own section above the canvas cards. The icon+name
// is a link that navigates into the folder (`/files/<id>`); the ⋮ menu (a
// sibling, since an anchor can't wrap a button) renames it in place (#484).
function FolderCard({ folder }: { folder: FolderSummary }) {
  const { renameFolder } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-foreground/20">
      <Link
        href={`/files/${folder.id}`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{folder.name}</span>
      </Link>
      <FolderActionMenu onRename={() => setRenameOpen(true)}>
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
