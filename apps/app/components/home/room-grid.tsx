"use client"

import { useState } from "react"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { getBranchColorByIndex } from "@/lib/branch-colors"
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { RoomActionMenu } from "./room-action-menu"
import { InputDialog } from "./input-dialog"
import { MoveToDialog } from "./move-to-dialog"
import { useHome } from "./home-provider"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { ThumbnailManifest } from "@/lib/thumbnail/manifest"

/**
 * Composes a Room's thumbnail from its Thumbnail Manifest: one positioned image
 * per Frame Capture, laid out by each frame's world-space rect normalized
 * against the manifest bounds. The composite box keeps the bounds' aspect ratio
 * and is centered inside the 4:3 card (contain, not stretch). Frames without a
 * capture yet (booting, skipped, or never captured) render as branch-tinted,
 * labeled placeholder rectangles — the snapshotted palette index is re-resolved
 * through `getBranchColorByIndex` so the tint stays theme-aware. Returns null
 * when there's nothing to place, so the card's gradient shows through (legacy
 * rows have a null manifest and never reach here).
 */
function ThumbnailComposite({
  manifest,
  version,
}: {
  manifest: ThumbnailManifest
  version: number | null
}) {
  const { bounds, frames } = manifest
  if (bounds.width <= 0 || bounds.height <= 0 || frames.length === 0)
    return null

  // Bind the composite to whichever card edge the bounds fill first, letting the
  // other dimension follow from the aspect ratio — true "contain" with no CSS
  // overflow math.
  const CARD_ASPECT = 4 / 3
  const boundsAspect = bounds.width / bounds.height
  const sizeStyle =
    boundsAspect > CARD_ASPECT
      ? { width: "100%", aspectRatio: `${bounds.width} / ${bounds.height}` }
      : { height: "100%", aspectRatio: `${bounds.width} / ${bounds.height}` }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative" style={sizeStyle}>
        {frames.map((frame) => {
          const style = {
            left: `${((frame.x - bounds.x) / bounds.width) * 100}%`,
            top: `${((frame.y - bounds.y) / bounds.height) * 100}%`,
            width: `${(frame.width / bounds.width) * 100}%`,
            height: `${(frame.height / bounds.height) * 100}%`,
          }
          if (!frame.capture) {
            // Branch-tinted, labeled placeholder: re-resolve the snapshotted
            // palette index to theme-aware classes (light/dark). A frame bound
            // to no Branch (or a legacy v1 manifest with no index) falls back to
            // a neutral tint.
            const color =
              frame.paletteIndex != null
                ? getBranchColorByIndex(frame.paletteIndex)
                : undefined
            return (
              <div
                key={frame.id}
                style={style}
                className={cn(
                  "absolute flex items-center justify-center overflow-hidden p-1 text-center text-[8px] leading-tight font-medium",
                  color ? color.badge : "bg-foreground/5 text-muted-foreground"
                )}
              >
                <span className="truncate">{frame.label}</span>
              </div>
            )
          }
          // The blob key is stable per (room, frame) and served with a max-age,
          // so version by the frame's own capture time — a retained capture keeps
          // its cached image while only the frames that actually recaptured bust.
          // Fall back to the room-wide version for legacy captures with no stamp.
          const v = frame.capture.capturedAt ?? version
          const src = v ? `${frame.capture.url}?v=${v}` : frame.capture.url
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={frame.id}
              src={src}
              alt=""
              style={style}
              className="absolute object-cover"
              // A stale capture URL (e.g. pre-restart blob scheme) 404s until the
              // room's next recapture; hide the broken glyph and let the blank
              // backdrop show instead of a broken-image icon.
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function RoomCard({ room }: { room: RoomSummary }) {
  const {
    renameRoom,
    removeRoom,
    moveRoom,
    allFolders,
    folderView,
    currentFolderId,
  } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

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
        {room.thumbnailManifest && (
          <ThumbnailComposite
            manifest={room.thumbnailManifest}
            version={room.thumbnailUpdatedAt}
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
          // Filing only makes sense where there's a folder tree to file into —
          // the files page, not the flat Recents view.
          onMove={folderView ? () => setMoveOpen(true) : undefined}
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
