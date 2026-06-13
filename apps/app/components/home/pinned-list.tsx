"use client"

import { useState } from "react"
import Link from "next/link"
import { FileText, MoreHorizontal } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"
import { useHome } from "./home-provider"
import { RoomActionMenu } from "./room-action-menu"
import { InputDialog } from "./input-dialog"
import { MoveToDialog } from "./move-to-dialog"

/**
 * The home sidebar's "Pinned" section (PRD #507): the user's pinned items as
 * quick-access rows, one click from the Canvas they point at. Rendered below the
 * Recents / All files / Settings nav and hidden entirely when nothing is pinned.
 *
 * The rows read their target from the lifted store's live `roomsById`, so a
 * rename or delete anywhere flows straight through — there's no second copy of
 * the Room's name to drift. This first slice only pins Rooms; the Folder slice
 * extends the same list with folder rows.
 */
export function PinnedList() {
  const { pins, roomsById } = useHome()

  // Resolve each Room pin to its live Room record, dropping any whose Room isn't
  // in the store (just deleted, or not yet loaded) so a dangling pin never paints
  // an empty row.
  const pinnedRooms = pins
    .filter((p) => p.kind === "room")
    .map((p) => roomsById.get(p.targetId))
    .filter((room): room is RoomSummary => room !== undefined)

  if (pinnedRooms.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Pinned</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {pinnedRooms.map((room) => (
            <PinnedRoomRow key={room.id} room={room} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function PinnedRoomRow({ room }: { room: RoomSummary }) {
  const { renameRoom, removeRoom, moveRoom, allFolders, folderOfRoom, unpin } =
    useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  // The Canvas's real current home, so "Move to…" marks it and a move always
  // relocates (the pinned row has no folder-view scope of its own).
  const currentParentId = folderOfRoom(room.id)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link
          href={`/${room.id}`}
          // Open the room's connection on hover/focus/click so the canvas renders
          // synced on the first frame, matching the grid tiles. No-op on hosted.
          onPointerEnter={() => prewarmRoom(room.id)}
          onFocus={() => prewarmRoom(room.id)}
          onClick={() => prewarmRoom(room.id)}
        >
          <FileText />
          <span className="truncate">{room.name}</span>
        </Link>
      </SidebarMenuButton>
      {/* The same full room-action-menu the grid tile uses — rename / share /
          move / delete / unpin all act on the lifted store, so edits made here
          update the grid behind the sidebar with no stale-state seam. */}
      <RoomActionMenu
        room={room}
        onRename={() => setRenameOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onShare={() => setShareOpen(true)}
        // Filing needs a folder tree to file into; offer it once the user has any
        // folder, regardless of which route the sidebar is on.
        onMove={allFolders.length > 0 ? () => setMoveOpen(true) : undefined}
        pinned
        onTogglePin={() => unpin("room", room.id)}
      >
        <SidebarMenuAction showOnHover aria-label="Canvas actions">
          <MoreHorizontal />
        </SidebarMenuAction>
      </RoomActionMenu>

      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename canvas"
        initialValue={room.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameRoom(room.id, name)}
      />
      <MoveToDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        itemName={room.name}
        currentParentId={currentParentId}
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
    </SidebarMenuItem>
  )
}
