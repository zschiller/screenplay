"use client"

import { useState } from "react"
import Link from "next/link"
import {
  File as FileIcon,
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
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { DeleteFolderDialog } from "@/components/delete-folder-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { RoomActionMenu } from "./room-action-menu"
import { FolderActionMenu } from "./folder-action-menu"
import { InputDialog } from "./input-dialog"
import { MoveToDialog } from "./move-to-dialog"
import { useFileDraggable, useFolderDragDrop } from "./file-dnd"
import { useHome } from "./home-provider"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { FolderSummary } from "@/lib/folders-actions"

// Compact folder row (PRD #475): a folder icon + name in the Name column, with
// the date/owner columns left empty so folders read as a distinct section above
// the canvases. Clicking the name navigates into the folder (`/files/<id>`);
// the ⋮ menu renames it in place (#484).
function FolderRow({ folder }: { folder: FolderSummary }) {
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

  // Both a drag source and a drop target (issue #487): file the folder elsewhere
  // by dragging it, or file canvases/folders into it by dropping onto its row.
  const { setNodeRef, attributes, listeners, isDragging, isOver } =
    useFolderDragDrop(folder)

  // Enumerate the cascade only while the confirm is open, from the live tree.
  const cascade = deleteOpen ? previewFolderDeletion(folder.id) : null

  return (
    <TableRow
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn("group", isOver && "bg-accent")}
    >
      <TableCell className="w-full">
        <Link href={`/files/${folder.id}`} className="flex items-center gap-2">
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium hover:underline">
            {folder.name}
          </span>
        </Link>
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell />
      <TableCell className="w-8 pr-2">
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
    !folderView
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
      className="group"
    >
      <TableCell className="w-full">
        <Link href={`/${room.id}`} className="flex items-center gap-2">
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium hover:underline">
            {room.name}
          </span>
        </Link>
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
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {room.isOwner ? "You" : "Shared"}
      </TableCell>
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

export function RoomTable({
  rooms,
  folders = [],
}: {
  rooms: RoomSummary[]
  folders?: FolderSummary[]
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Last edited</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* Folders render above the files, sorted within their own section. */}
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} />
        ))}
        {rooms.map((room) => (
          <RoomRow key={room.id} room={room} />
        ))}
      </TableBody>
    </Table>
  )
}
