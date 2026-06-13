"use client"

import { Folder as FolderIcon } from "lucide-react"
import type { FolderSummary } from "@/lib/folders-actions"

// Compact folder tiles for the grid view (PRD #475): folder icon + name, no
// thumbnail, sitting in their own section above the canvas cards. Clicking does
// nothing yet — navigating into a folder lands in a later slice.
function FolderCard({ folder }: { folder: FolderSummary }) {
  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-foreground/20">
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{folder.name}</span>
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
