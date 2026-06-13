"use client"

import { useState } from "react"
import Link from "next/link"
import { FileText, MoreHorizontal } from "lucide-react"
import { Reorder } from "motion/react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuAction,
  SidebarMenuButton,
} from "@workspace/ui/components/sidebar"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { PinKind } from "@/lib/pins"
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
 *
 * The list is drag-reorderable via Framer Motion's `Reorder` (PRD #513),
 * following the reorderable-tabs pattern in `components/agent/chat-panel.tsx` —
 * deliberately not the in-room sidebar's dnd-kit mechanism. `Reorder` hands back
 * the whole reordered run, which `reorderPins` persists as dense `position`
 * values; Room and Folder pins share one position space, so a mixed list
 * reorders freely. The key for each row is `kind:targetId` (a pin is addressed
 * by its target, never its server-side row id), so folder rows slot into the
 * same group unchanged once the Folder slice lands.
 */

/** A pin's stable drag key — its target, the same key the provider reorders by. */
function pinKey(kind: PinKind, targetId: string): string {
  return `${kind}:${targetId}`
}

export function PinnedList() {
  const { pins, roomsById, reorderPins } = useHome()

  // Resolve each pin to a renderable row, dropping any whose target isn't in the
  // store (just deleted, or not yet loaded) so a dangling pin never paints an
  // empty row. This first slice only renders Room pins; folder rows extend the
  // same resolved list. The resolved order is what the Reorder group drags over,
  // so its `values` and its rendered items stay in lockstep.
  const renderable = pins
    .map((p) => {
      if (p.kind === "room") {
        const room = roomsById.get(p.targetId)
        return room ? { key: pinKey("room", p.targetId), room } : null
      }
      return null
    })
    .filter((r): r is { key: string; room: RoomSummary } => r !== null)

  if (renderable.length === 0) return null

  // `Reorder` returns the whole reordered key list; map each key back to its
  // `kind` + `targetId` and persist the new order. Room and Folder pins reorder
  // within this one shared run.
  const handleReorder = (keys: string[]) => {
    const ordered = keys.map((key) => {
      const sep = key.indexOf(":")
      return {
        kind: key.slice(0, sep) as PinKind,
        targetId: key.slice(sep + 1),
      }
    })
    void reorderPins(ordered)
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Pinned</SidebarGroupLabel>
      <SidebarGroupContent>
        <Reorder.Group
          as="ul"
          axis="y"
          values={renderable.map((r) => r.key)}
          onReorder={handleReorder}
          data-slot="sidebar-menu"
          data-sidebar="menu"
          className="flex w-full min-w-0 flex-col gap-0"
        >
          {renderable.map(({ key, room }) => (
            <PinnedRoomRow key={key} dragKey={key} room={room} />
          ))}
        </Reorder.Group>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function PinnedRoomRow({
  dragKey,
  room,
}: {
  dragKey: string
  room: RoomSummary
}) {
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
    // A draggable pinned row. `Reorder.Item` runs the drag/layout gesture and
    // distinguishes a drag from a click by movement, so the Link still navigates
    // on a plain click while a drag reorders. `cursor-grab` signals the affordance.
    <Reorder.Item
      value={dragKey}
      as="li"
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className="group/menu-item relative cursor-grab active:cursor-grabbing"
    >
      <SidebarMenuButton asChild>
        <Link
          href={`/${room.id}`}
          // The browser's native link-drag would hijack the pointer and paint a
          // ghost image, fighting the Reorder gesture — opt the row out of it.
          draggable={false}
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
    </Reorder.Item>
  )
}
