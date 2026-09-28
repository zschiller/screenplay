"use client"

import { Fragment, useMemo, useRef, useState } from "react"
import {
  Check,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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

/**
 * Whether "Move to…" is offered for a Canvas: once the user has any Folder to
 * file into, on every surface that lists the Canvas (grid, table, sidebar pin),
 * whichever route it's on. One rule, so the same Canvas never offers a Move in
 * one view and hides it in another. (A Folder can always move, to the root at
 * least, so its menu doesn't ask.)
 */
export function canMoveRoom(folders: FolderSummary[]): boolean {
  return folders.length > 0
}

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
  /**
   * Create a folder named `name` under `parentFolderId` (null = the root).
   * Offers New folder when given; the new folder must then appear in `folders`.
   */
  onCreateFolder?: (
    name: string,
    parentFolderId: string | null
  ) => Promise<FolderSummary>
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
  onCreateFolder,
}: MoveToDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // Escape in New folder's name field closes the field, not the dialog.
        onEscapeKeyDown={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest("[data-new-folder]")
          )
            e.preventDefault()
        }}
      >
        {/* Mount the form only while open so its selection/error state resets
            on each open, matching InputDialog. */}
        {open && (
          <MoveToForm
            itemName={itemName}
            currentParentId={currentParentId}
            movingFolderId={movingFolderId}
            folders={folders}
            onMove={onMove}
            onCreateFolder={onCreateFolder}
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
  onCreateFolder,
  onClose,
}: {
  itemName: string
  currentParentId: string | null
  movingFolderId?: string
  folders: FolderSummary[]
  onMove: (targetId: string | null) => Promise<void>
  onCreateFolder?: MoveToDialogProps["onCreateFolder"]
  onClose: () => void
}) {
  // `undefined` = nothing picked yet (Move stays disabled); `null` = the root;
  // a string = a folder. Kept distinct so "root" is a real, selectable choice.
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Where New folder's name field sits: under this parent (null = the root),
  // or `undefined` while it's closed.
  const [newFolderParent, setNewFolderParent] = useState<
    string | null | undefined
  >(undefined)

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

  // Roving tabindex, per the ARIA radio group pattern: the group is one Tab
  // stop — the picked destination, else the first one on offer — and the arrow
  // keys walk the enabled destinations, picking as they go.
  const destinations: Array<string | null> = [
    null,
    ...rows.map(({ folder }) => folder.id),
  ]
  const tabStop =
    selected !== undefined && !isDisabled(selected)
      ? selected
      : destinations.find((id) => !isDisabled(id))
  const groupRef = useRef<HTMLDivElement>(null)

  function handleGroupKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role=radio]:not(:disabled)"
      ) ?? []
    )
    if (radios.length === 0) return
    const current = radios.indexOf(e.target as HTMLButtonElement)
    let next: number
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (current + 1) % radios.length
        break
      case "ArrowUp":
      case "ArrowLeft":
        next = (current - 1 + radios.length) % radios.length
        break
      case "Home":
        next = 0
        break
      case "End":
        next = radios.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    radios[next]!.focus()
    radios[next]!.click()
  }

  // New folder goes inside the picked destination, else at the root.
  function openNewFolder() {
    setError(null)
    setNewFolderParent(selected ?? null)
  }

  async function handleCreateFolder(name: string) {
    if (!onCreateFolder || newFolderParent === undefined) return
    setError(null)
    try {
      const folder = await onCreateFolder(name, newFolderParent)
      setNewFolderParent(undefined)
      setSelected(folder.id)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't create the folder"
      )
      throw err
    }
  }

  // Indent one level under the parent row it's nested in.
  const newFolderRow = (depth: number) => (
    <NewFolderRow
      depth={depth}
      onSubmit={handleCreateFolder}
      onCancel={() => setNewFolderParent(undefined)}
    />
  )

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
        <div
          ref={groupRef}
          role="radiogroup"
          aria-label="Destination"
          onKeyDown={handleGroupKeyDown}
          // Room for the focus ring, which the scroll viewport would clip.
          className="flex flex-col gap-0.5 p-1 pr-3"
        >
          <DestinationRow
            label="All files"
            icon={
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            }
            depth={0}
            selected={selected === null}
            tabbable={tabStop === null}
            disabled={isDisabled(null)}
            onSelect={() => setSelected(null)}
          />
          {newFolderParent === null && newFolderRow(1)}
          {rows.map(({ folder, depth }) => (
            <Fragment key={folder.id}>
              <DestinationRow
                label={folder.name}
                icon={
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                }
                // Nest under the root crumb's indent.
                depth={depth + 1}
                selected={selected === folder.id}
                tabbable={tabStop === folder.id}
                disabled={isDisabled(folder.id)}
                onSelect={() => setSelected(folder.id)}
              />
              {newFolderParent === folder.id && newFolderRow(depth + 2)}
            </Fragment>
          ))}
        </div>
      </ScrollArea>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        {onCreateFolder && (
          <Button
            type="button"
            variant="outline"
            className="sm:mr-auto"
            disabled={newFolderParent !== undefined || pending}
            onClick={openNewFolder}
          >
            <FolderPlus />
            New folder
          </Button>
        )}
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
  tabbable,
  disabled,
  onSelect,
}: {
  label: string
  icon: React.ReactNode
  depth: number
  selected: boolean
  /** The group's one Tab stop; the others are reached with the arrow keys. */
  tabbable: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabbable ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      className={cn(
        "flex items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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

/**
 * The name field New folder opens in the tree, at the depth the folder will
 * live. Enter creates it; Escape, or leaving it empty, backs out (the dialog
 * lets Escape through to the field, so it closes only the field).
 */
function NewFolderRow({
  depth,
  onSubmit,
  onCancel,
}: {
  depth: number
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return onCancel()
    setPending(true)
    try {
      await onSubmit(trimmed)
    } catch {
      // The form shows the error; keep the name so it can be retried.
      setPending(false)
    }
  }

  return (
    <div
      data-new-folder
      className="flex items-center gap-2 py-0.5"
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
    >
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      <Input
        autoFocus
        aria-label="New folder name"
        placeholder="Folder name"
        className="h-7"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Keep the arrow keys and Home/End in the field, not the radio group.
          e.stopPropagation()
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => {
          if (!name.trim() && !pending) onCancel()
        }}
      />
    </div>
  )
}
