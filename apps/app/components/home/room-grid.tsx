"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { RoomActionMenu } from "./room-action-menu"
import { InputDialog } from "./input-dialog"
import { useHome } from "./home-provider"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"

function RoomCard({ room }: { room: RoomSummary }) {
  const { renameRoom, removeRoom } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <div
      // Open the room's connection on hover/focus so it's synced by the time the
      // route mounts — the canvas renders on the first frame with no sync-gate
      // flash. No-op on the hosted build.
      onPointerEnter={() => prewarmRoom(room.id)}
      onFocus={() => prewarmRoom(room.id)}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-foreground/20"
    >
      <Link
        href={`/${room.id}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-muted to-muted/40"
        aria-label={`Open ${room.name}`}
      >
        {room.thumbnailUrl && (
          <Image
            key={room.thumbnailUpdatedAt ?? room.thumbnailUrl}
            // The blob path is stable per room and served with a max-age, so a
            // bare URL would show the browser-cached capture for up to that
            // TTL; versioning by capture time busts it the moment a new
            // thumbnail lands.
            src={
              room.thumbnailUpdatedAt
                ? `${room.thumbnailUrl}?v=${room.thumbnailUpdatedAt}`
                : room.thumbnailUrl
            }
            alt=""
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
            className="object-cover"
            unoptimized
            // A stale URL (e.g. captured before a restart under the old
            // absolute-URL scheme) 404s until the room's next recapture; hide
            // the broken-image glyph and show the gradient instead. The key
            // above remounts a fresh, visible img when a new capture lands.
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
      </Link>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/${room.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {room.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {/* Relative time reads Date.now(), which differs between the SSR
                pass and hydration; keep the server value rather than
                regenerate. */}
            <span suppressHydrationWarning>
              Edited{" "}
              {formatDistanceToNow(room.lastConnectionAt ?? room.createdAt)}
            </span>
            {!room.isOwner && (
              <>
                <span>·</span>
                <span>Shared</span>
              </>
            )}
          </div>
        </div>
        <RoomActionMenu
          room={room}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onShare={() => setShareOpen(true)}
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
      </div>

      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename canvas"
        initialValue={room.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameRoom(room.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={room.name}
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
    </div>
  )
}

export function RoomGrid({ rooms }: { rooms: RoomSummary[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} />
      ))}
    </div>
  )
}
