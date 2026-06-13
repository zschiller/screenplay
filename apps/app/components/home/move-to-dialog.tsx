"use client"

import { useMemo, useState } from "react"
import { Check, Folder as FolderIcon, FolderOpen } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { foldersInParent } from "@/lib/folder-tree"
import { descendantFolderIds } from "@/lib/folder-cascade"
import type { FolderSummary } from "@/lib/folders-actions"

// The "Move to…" folder picker (PRD #475). Lists the user's whole folder tree —
// the root ("All files") plus every folder, indented by depth — and moves the
// item to whichever destination the user picks. It works for both Rooms (filed
// via their per-user placement) and Folders (re-parented); the caller wires
// `onMove` to the right operation. For a Folder, `movingFolderId` makes the
// picker disable the folder itself and its descendants, so a move can't create
// a cycle — the same rule `moveFolder` enforces server-side.

type MoveToDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The item being moved, named in the dialog title. */
  itemName: string
  /**
   * The item's current container (null = the "All files" root). Shown as its
   * current home and not offered as a destination, so a move always relocates.
   */
  currentParentId: string | null
  /**
   * When moving a Folder, that folder's own id — the picker disables it and its
   * descendants to prevent a cycle. Omitted when moving a Room (no cycle risk).
   */
  movingFolderId?: string
  /** The user's whole folder tree (unsorted); the picker orders it itself. */
  folders: FolderSummary[]
  /** Commit the move to `targetId` (null = the root). */
  onMove: (targetId: string | null) => Promise<void>
}

// A folder plus its depth in the tree, in root→leaf, name-sorted order — the
// flat list the picker renders with one indent step per level.
type Row = { folder: FolderSummary; depth: number }

function flattenTree(
  folders: FolderSummary[],
  parentFolderId: string | null,
  depth: number
): Row[] {
  return foldersInParent(folders, parentFolderId, "name", "asc").flatMap(
    (folder) => [
      { folder, depth },
      ...flattenTree(folders, folder.id, depth + 1),
    ]
  )
}

export function MoveToDialog({
  open,
  onOpenChange,
  itemName,
  currentParentId,
  movingFolderId,
  folders,
  onMove,
}: MoveToDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mount the form only while open so its selection/error state resets
            on each open, matching InputDialog. */}
        {open && (
          <MoveToForm
            itemName={itemName}
            currentParentId={currentParentId}
            movingFolderId={movingFolderId}
            folders={folders}
            onMove={onMove}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MoveToForm({
  itemName,
  currentParentId,
  movingFolderId,
  folders,
  onMove,
  onClose,
}: {
  itemName: string
  currentParentId: string | null
  movingFolderId?: string
  folders: FolderSummary[]
  onMove: (targetId: string | null) => Promise<void>
  onClose: () => void
}) {
  // `undefined` = nothing picked yet (Move stays disabled); `null` = the root;
  // a string = a folder. Kept distinct so "root" is a real, selectable choice.
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => flattenTree(folders, null, 0), [folders])
  // The folder being moved plus its descendants are off-limits (would cycle).
  // `descendantFolderIds` includes the folder itself, so this covers it too.
  const blocked = useMemo(
    () =>
      movingFolderId
        ? new Set(descendantFolderIds(movingFolderId, folders))
        : new Set<string>(),
    [folders, movingFolderId]
  )

  // A destination is unavailable if it's where the item already lives, or — for
  // a folder move — the folder itself or one of its descendants.
  function isDisabled(targetId: string | null): boolean {
    if (targetId === currentParentId) return true
    if (targetId === null) return false
    return blocked.has(targetId)
  }

  async function handleMove() {
    if (selected === undefined) return
    setPending(true)
    setError(null)
    try {
      await onMove(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move")
      setPending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move &ldquo;{itemName}&rdquo;</DialogTitle>
        <DialogDescription>Choose a destination folder.</DialogDescription>
      </DialogHeader>
      <ScrollArea className="my-2 max-h-72">
        <div role="radiogroup" className="flex flex-col gap-0.5 pr-2">
          <DestinationRow
            label="All files"
            icon={
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            }
            depth={0}
            selected={selected === null}
            disabled={isDisabled(null)}
            onSelect={() => setSelected(null)}
          />
          {rows.map(({ folder, depth }) => (
            <DestinationRow
              key={folder.id}
              label={folder.name}
              icon={
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              }
              // Nest under the root crumb's indent.
              depth={depth + 1}
              selected={selected === folder.id}
              disabled={isDisabled(folder.id)}
              onSelect={() => setSelected(folder.id)}
            />
          ))}
        </div>
      </ScrollArea>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={selected === undefined || pending}
          onClick={handleMove}
        >
          {pending ? "Moving…" : "Move"}
        </Button>
      </DialogFooter>
    </>
  )
}

function DestinationRow({
  label,
  icon,
  depth,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  icon: React.ReactNode
  depth: number
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      className={cn(
        "flex items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50 disabled:hover:bg-transparent"
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check className="size-4 shrink-0" />}
    </button>
  )
}
