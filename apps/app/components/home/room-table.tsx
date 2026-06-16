"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Folder as FolderIcon,
  MoreHorizontal,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"
import { isLocalBuild } from "@/lib/local-mode"
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { DeleteFolderDialog } from "@/components/delete-folder-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { RoomActionMenu } from "./room-action-menu"
import { FolderActionMenu } from "./folder-action-menu"
import { InputDialog } from "./input-dialog"
import { MoveToDialog } from "./move-to-dialog"
import { useFileDraggable, useFolderDragDrop } from "./file-dnd"
import { ThumbnailComposite } from "./room-grid"
import { useHome } from "./home-provider"
import type { SortKey } from "@/lib/room-sort"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { FolderSummary } from "@/lib/folders-actions"

// The Name-column content of a folder row — icon + name link. Shared by the
// live row and its drag preview so they stay in sync.
function FolderRowName({ folder }: { folder: FolderSummary }) {
  return (
    <Link href={`/files/${folder.id}`} className="flex items-center gap-2">
      <FolderIcon className="size-4 shrink-0 text-primary" />
      <span className="truncate font-medium">{folder.name}</span>
    </Link>
  )
}

// A canvas row's leading thumbnail — the grid card's preview shrunk to a 4:3
// row tile, standing in for the old empty-doc icon. Renders the same frame
// composite as the grid (`ThumbnailComposite`) over the gradient backdrop the
// grid card uses, so a captured canvas shows its real layout and an uncaptured
// one reads as a blank document. The composite never draws text.
function RoomRowThumbnail({ room }: { room: RoomSummary }) {
  return (
    <div className="relative aspect-[4/3] h-20 shrink-0 overflow-hidden rounded-xs bg-muted-foreground/15">
      {room.thumbnailManifest && (
        <ThumbnailComposite
          manifest={room.thumbnailManifest}
          version={room.thumbnailUpdatedAt}
          insetClassName="p-px"
        />
      )}
    </div>
  )
}

// The Name-column content of a canvas row — thumbnail + name link. Shared by the
// live row and its drag preview.
function RoomRowName({ room }: { room: RoomSummary }) {
  return (
    <Link href={`/${room.id}`} className="flex items-center gap-2">
      <RoomRowThumbnail room={room} />
      <span className="truncate font-medium">{room.name}</span>
    </Link>
  )
}

// A dragged row can't float as a real <tr> (it needs its table), so its preview
// is the row's own Name cell in a lifted chip — same icon+name component, sized
// by the overlay to the row's width.
const ROW_PREVIEW_CHIP =
  "rounded-lg border border-border bg-background px-4 py-2 text-sm shadow-lg ring-1 ring-foreground/10"

// A <tr> can't take a border-radius, so paint the hover highlight on the cells
// instead — rounding the leading/trailing cells gives the row a rounded pill.
// The base TableRow paints its own rect on hover; suppress it (`!`) so only the
// rounded cell fill shows.
const ROW_HOVER_PILL =
  "hover:bg-transparent! [&>td]:transition-colors hover:[&>td]:bg-muted/50 " +
  "[&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg"

export function FolderRowDragPreview({ folder }: { folder: FolderSummary }) {
  return (
    <div className={ROW_PREVIEW_CHIP}>
      <FolderRowName folder={folder} />
    </div>
  )
}

export function RoomRowDragPreview({ room }: { room: RoomSummary }) {
  return (
    <div className={ROW_PREVIEW_CHIP}>
      <RoomRowName room={room} />
    </div>
  )
}

// Folder row (PRD #475): a folder icon + name in the Name column, with the same
// edited/created columns as canvases; only the owner column stays empty. Clicking
// the name navigates into the folder (`/files/<id>`); the ⋮ menu renames it in
// place (#484).
function FolderRow({ folder }: { folder: FolderSummary }) {
  const {
    renameFolder,
    moveFolder,
    allFolders,
    previewFolderDeletion,
    removeFolder,
    isPinned,
    pinFolder,
    unpin,
  } = useHome()
  const pinned = isPinned("folder", folder.id)
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Both a drag source and a drop target (issue #487): file the folder elsewhere
  // by dragging it, or file canvases/folders into it by dropping onto its row.
  const { setNodeRef, attributes, listeners, isDragging, isOver } =
    useFolderDragDrop(folder, <FolderRowDragPreview folder={folder} />)

  // Enumerate the cascade only while the confirm is open, from the live tree.
  const cascade = deleteOpen ? previewFolderDeletion(folder.id) : null

  return (
    <TableRow
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0 : undefined }}
      // Folder rows carry only an icon + name, so trim their vertical padding to
      // sit shorter than the thumbnail-bearing canvas rows.
      className={cn(
        "group border-b-0 [&>td]:py-1.5",
        ROW_HOVER_PILL,
        isOver && "bg-accent"
      )}
    >
      <TableCell>
        <FolderRowName folder={folder} />
      </TableCell>
      {/* Relative times read Date.now(), which differs between the SSR pass
          and hydration; keep the server value rather than regenerate. */}
      <TableCell
        suppressHydrationWarning
        className="whitespace-nowrap text-muted-foreground"
      >
        {formatDistanceToNow(folder.updatedAt)}
      </TableCell>
      <TableCell
        suppressHydrationWarning
        className="whitespace-nowrap text-muted-foreground"
      >
        {formatDistanceToNow(folder.createdAt)}
      </TableCell>
      {/* Owner column is hidden in the single-user desktop build. */}
      {!isLocalBuild && <TableCell />}
      <TableCell className="w-8 pr-2">
        <FolderActionMenu
          onRename={() => setRenameOpen(true)}
          onMove={() => setMoveOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          pinned={pinned}
          onTogglePin={() =>
            pinned ? unpin("folder", folder.id) : pinFolder(folder.id)
          }
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
      </TableCell>

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
    </TableRow>
  )
}

function RoomRow({ room }: { room: RoomSummary }) {
  const {
    renameRoom,
    removeRoom,
    moveRoom,
    allFolders,
    folderView,
    currentFolderId,
    isPinned,
    pinRoom,
    unpin,
  } = useHome()
  const pinned = isPinned("room", room.id)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  // Draggable onto a folder row to file it (issue #487); enabled only on the
  // files page, where the displayed rooms live in the folder being viewed.
  const { setNodeRef, attributes, listeners, isDragging } = useFileDraggable(
    {
      kind: "room",
      id: room.id,
      name: room.name,
      currentParentId: currentFolderId,
    },
    { disabled: !folderView, preview: <RoomRowDragPreview room={room} /> }
  )

  return (
    <TableRow
      ref={setNodeRef}
      {...(folderView ? attributes : {})}
      {...(folderView ? listeners : {})}
      // Prewarm the room connection on hover/focus so the canvas renders on the
      // first frame without a sync-gate flash. No-op on the hosted build.
      onPointerEnter={() => prewarmRoom(room.id)}
      onFocus={() => prewarmRoom(room.id)}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn("group border-b-0", ROW_HOVER_PILL)}
    >
      <TableCell>
        <RoomRowName room={room} />
      </TableCell>
      {/* Relative times read Date.now(), which differs between the SSR pass
          and hydration; keep the server value rather than regenerate. */}
      <TableCell
        suppressHydrationWarning
        className="whitespace-nowrap text-muted-foreground"
      >
        {formatDistanceToNow(room.lastConnectionAt ?? room.createdAt)}
      </TableCell>
      <TableCell
        suppressHydrationWarning
        className="whitespace-nowrap text-muted-foreground"
      >
        {formatDistanceToNow(room.createdAt)}
      </TableCell>
      {/* Owner column is hidden in the single-user desktop build. */}
      {!isLocalBuild && (
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {room.isOwner ? "You" : "Shared"}
        </TableCell>
      )}
      <TableCell className="w-8 pr-2">
        <RoomActionMenu
          room={room}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onShare={() => setShareOpen(true)}
          // Filing only makes sense where there's a folder tree to file into —
          // the files page, not the flat Recents view.
          onMove={folderView ? () => setMoveOpen(true) : undefined}
          pinned={pinned}
          onTogglePin={() =>
            pinned ? unpin("room", room.id) : pinRoom(room.id)
          }
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Canvas actions"
          >
            <MoreHorizontal />
          </Button>
        </RoomActionMenu>
      </TableCell>

      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename canvas"
        initialValue={room.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameRoom(room.id, name)}
      />
      {/* In a folder view every Room shown is placed in the folder being viewed,
          so its current home is `currentFolderId`. */}
      <MoveToDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        itemName={room.name}
        currentParentId={currentFolderId}
        folders={allFolders}
        onMove={(target) => moveRoom(room.id, target)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={room.name}
        isOwner={room.isOwner}
        sharedWithCount={room.sharedWithCount}
        onConfirm={async () => {
          await removeRoom(room.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareRoomDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          roomId={room.id}
          roomName={room.name}
        />
      )}
    </TableRow>
  )
}

// An interactive, sortable column header (shadcn's data-table pattern: a ghost
// Button inside the <th>). Clicking the active column flips its direction;
// clicking another switches the sort key to that column's natural default. The
// arrow shows the live direction on the active column and a faded up/down hint
// on the rest. `aria-sort` mirrors the state for assistive tech.
function SortableHead({
  label,
  sortKey,
  className,
  style,
}: {
  label: string
  sortKey: SortKey
  className?: string
  style?: React.CSSProperties
}) {
  const { sort, order, setSort, setOrder } = useHome()
  const active = sort === sortKey

  return (
    <TableHead
      className={className}
      style={style}
      aria-sort={
        active ? (order === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Button
        variant="ghost"
        size="sm"
        // Pull the button left by its own padding so the label aligns with the
        // body cells' text below it.
        className={cn(
          "-ml-2.5 data-[active=true]:text-foreground",
          active ? "text-foreground" : "text-muted-foreground"
        )}
        data-active={active}
        onClick={() =>
          active ? setOrder(order === "asc" ? "desc" : "asc") : setSort(sortKey)
        }
      >
        {label}
        {active ? (
          order === "asc" ? (
            <ArrowUp />
          ) : (
            <ArrowDown />
          )
        ) : (
          <ChevronsUpDown className="opacity-50" />
        )}
      </Button>
    </TableHead>
  )
}

export function RoomTable({
  rooms,
  folders = [],
}: {
  rooms: RoomSummary[]
  folders?: FolderSummary[]
}) {
  return (
    <Table className="table-fixed">
      <TableHeader className="[&_tr]:border-b-0">
        <TableRow className="hover:bg-transparent!">
          <SortableHead label="Name" sortKey="name" />
          <SortableHead
            label="Last edited"
            sortKey="updated"
            className="whitespace-nowrap"
            style={{ width: "10rem" }}
          />
          <SortableHead
            label="Created"
            sortKey="created"
            className="whitespace-nowrap"
            style={{ width: "10rem" }}
          />
          {/* Owner column is hidden in the single-user desktop build. It carries
              no sort key, so it stays a plain label. */}
          {!isLocalBuild && (
            <TableHead
              className="whitespace-nowrap"
              style={{ width: "6.5rem" }}
            >
              Owner
            </TableHead>
          )}
          <TableHead style={{ width: "3rem" }} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Folders render above the files, sorted within their own section. */}
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} />
        ))}
        {/* A non-interactive spacer row sets the folder section apart from the
            canvas section — a real gap that isn't part of either row's hover. */}
        {folders.length > 0 && rooms.length > 0 && (
          <tr aria-hidden className="h-3" />
        )}
        {rooms.map((room) => (
          <RoomRow key={room.id} room={room} />
        ))}
      </TableBody>
    </Table>
  )
}
