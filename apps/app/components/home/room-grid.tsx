"use client"

import { useState } from "react"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"
import { CanvasIcon } from "@/components/canvas-icon"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { formatDistanceToNow } from "@/lib/utils"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { RoomActionMenu } from "./room-action-menu"
import { InputDialog } from "./input-dialog"
import { MoveToDialog, canMoveRoom } from "./move-to-dialog"
import { useFileDraggable } from "./file-dnd"
import { useHome } from "./home-provider"
import { prewarmRoom } from "@/lib/yjs-host/client"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { ThumbnailManifest } from "@/lib/thumbnail/manifest"
import { ACTION_TRIGGER_REVEAL } from "./action-trigger"
import { ResultLocation } from "./result-location"

/**
 * Whether a Room has anything to preview. A null manifest (never captured) and
 * an empty one both mean no: the tile and row show the empty preview instead.
 */
export function hasThumbnail(
  manifest: ThumbnailManifest | null | undefined
): manifest is ThumbnailManifest {
  return (
    !!manifest &&
    manifest.bounds.width > 0 &&
    manifest.bounds.height > 0 &&
    manifest.frames.length > 0
  )
}

/**
 * The stand-in for a Canvas with no preview yet: a quiet dashed slot with the
 * Canvas icon, used by both the grid card and the table row so a blank canvas
 * reads as "nothing captured" rather than a grey block.
 */
export function EmptyThumbnail({
  className,
  iconClassName,
}: {
  className?: string
  iconClassName?: string
}) {
  return (
    <div
      className={cn(
        "grid place-items-center border border-dashed border-border text-muted-foreground/70",
        className
      )}
    >
      <CanvasIcon className={cn("size-4", iconClassName)} />
    </div>
  )
}

/**
 * Composes a Room's thumbnail from its Thumbnail Manifest: one positioned image
 * per Frame Capture, laid out by each frame's world-space rect normalized
 * against the manifest bounds. The composite box keeps the bounds' aspect ratio
 * and is centered inside the 4:3 card (contain, not stretch), inset by a small
 * padding so frames breathe rather than butting up against the card edge. Frames
 * without a capture yet (booting, skipped, or never captured) render as neutral
 * placeholder blocks. Returns null
 * when there's nothing to place, so the card's gradient shows through (legacy
 * rows have a null manifest and never reach here).
 */
export function ThumbnailComposite({
  manifest,
  version,
  // The breathing room between the frame composite and its container edge.
  // The grid card wants a generous inset; the table's small row tile overrides
  // it to a hairline so the preview reads at thumbnail size.
  insetClassName = "p-3",
}: {
  manifest: ThumbnailManifest
  version: number | null
  insetClassName?: string
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
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center",
        insetClassName
      )}
    >
      <div className="relative" style={sizeStyle}>
        {frames.map((frame) => {
          const style = {
            left: `${((frame.x - bounds.x) / bounds.width) * 100}%`,
            top: `${((frame.y - bounds.y) / bounds.height) * 100}%`,
            width: `${(frame.width / bounds.width) * 100}%`,
            height: `${(frame.height / bounds.height) * 100}%`,
          }
          if (!frame.capture) {
            // Neutral placeholder. The thumbnail render never draws text — the
            // block stands in for an uncaptured frame on its own. (A legacy
            // `paletteIndex` on a stored manifest is ignored.)
            return (
              <div
                key={frame.id}
                style={style}
                className="absolute overflow-hidden bg-foreground/5"
              />
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

// The structural classes of a canvas tile's outer box, shared by the live card
// and its drag preview so they can never drift apart. The card layers on hover
// affordances; the preview layers on the lifted shadow.
const ROOM_TILE_OUTER =
  "flex flex-col overflow-hidden rounded-lg border border-border bg-background"

// The full visual face of a canvas tile — thumbnail panel over name/metadata,
// with the ⋮ menu in the trailing slot. Rendered by both `RoomCard` (live, with
// the real action menu) and `RoomTileDragPreview` (static, with an invisible
// placeholder that just reserves the menu's space). One source of truth: edit
// the tile here and the drag preview follows automatically.
function RoomTileFace({
  room,
  menu,
  location,
}: {
  room: RoomSummary
  menu: React.ReactNode
  /** A search result's folder trail, leading the metadata line (#807). */
  location?: React.ReactNode
}) {
  return (
    <>
      <Link
        href={`/${room.id}`}
        className={cn(
          "relative block aspect-[4/3] w-full overflow-hidden",
          hasThumbnail(room.thumbnailManifest) && "bg-muted-foreground/15"
        )}
        aria-label={`Open ${room.name}`}
      >
        {hasThumbnail(room.thumbnailManifest) ? (
          <ThumbnailComposite
            manifest={room.thumbnailManifest}
            version={room.thumbnailUpdatedAt}
          />
        ) : (
          <EmptyThumbnail
            className="absolute inset-3 rounded-md"
            iconClassName="size-5"
          />
        )}
      </Link>
      <div className="flex items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/${room.id}`}
            className="block truncate text-sm font-medium"
          >
            {room.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {location && (
              <>
                <span className="min-w-0 shrink">{location}</span>
                <span>·</span>
              </>
            )}
            {/* Relative time reads Date.now(), which differs between the SSR
                pass and hydration; keep the server value rather than
                regenerate. */}
            <span suppressHydrationWarning className="shrink-0">
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
        {menu}
      </div>
    </>
  )
}

/**
 * The node floated under the cursor while a canvas tile is dragged — the same
 * `RoomTileFace` the live card renders, lifted off the page with a shadow. The
 * menu slot is an invisible button that only reserves the trailing space (its
 * resting state on the card), so widths line up exactly.
 */
export function RoomTileDragPreview({ room }: { room: RoomSummary }) {
  return (
    <div className={cn(ROOM_TILE_OUTER, "shadow-lg ring-1 ring-foreground/10")}>
      <RoomTileFace
        room={room}
        menu={
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0"
            aria-hidden
            tabIndex={-1}
          >
            <MoreHorizontal />
          </Button>
        }
      />
    </div>
  )
}

function RoomCard({
  room,
  showLocation,
}: {
  room: RoomSummary
  showLocation: boolean
}) {
  const {
    renameRoom,
    removeRoom,
    moveRoom,
    createFolder,
    allFolders,
    folderView,
    folderOfRoom,
    isPinned,
    pinRoom,
    unpin,
  } = useHome()
  const pinned = isPinned("room", room.id)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  // Draggable onto a folder to file it (issue #487), but only on the files page
  // where there are folders to file into — the flat Recents view disables it.
  // The Room's own folder is the home a drop relocates from, which search
  // results (spanning every folder) need as much as a folder view.
  const { setNodeRef, attributes, listeners, isDragging } = useFileDraggable(
    {
      kind: "room",
      id: room.id,
      name: room.name,
      currentParentId: folderOfRoom(room.id),
    },
    { disabled: !folderView, preview: <RoomTileDragPreview room={room} /> }
  )

  return (
    <div
      ref={setNodeRef}
      {...(folderView ? attributes : {})}
      {...(folderView ? listeners : {})}
      // Open the room's connection on hover/focus so it's synced by the time the
      // route mounts — the canvas renders on the first frame with no sync-gate
      // flash. No-op on the hosted build.
      onPointerEnter={() => prewarmRoom(room.id)}
      onFocus={() => prewarmRoom(room.id)}
      style={{ opacity: isDragging ? 0 : undefined }}
      className={cn(
        ROOM_TILE_OUTER,
        "group relative transition-colors hover:border-foreground/20"
      )}
    >
      <RoomTileFace
        room={room}
        location={
          showLocation && <ResultLocation folderId={folderOfRoom(room.id)} />
        }
        menu={
          <RoomActionMenu
            room={room}
            onRename={() => setRenameOpen(true)}
            onDelete={() => setDeleteOpen(true)}
            onShare={() => setShareOpen(true)}
            onMove={
              canMoveRoom(allFolders) ? () => setMoveOpen(true) : undefined
            }
            pinned={pinned}
            onTogglePin={() =>
              pinned ? unpin("room", room.id) : pinRoom(room.id)
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className={ACTION_TRIGGER_REVEAL}
              aria-label="Canvas actions"
            >
              <MoreHorizontal />
            </Button>
          </RoomActionMenu>
        }
      />

      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename canvas"
        errorMessage="Couldn't rename the canvas. Try again."
        initialValue={room.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameRoom(room.id, name)}
      />
      {/* The Canvas's real home, not the view's: on Recents the grid spans
          every folder, so the folder being viewed says nothing about it. */}
      <MoveToDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        itemName={room.name}
        currentParentId={folderOfRoom(room.id)}
        folders={allFolders}
        onMove={(target) => moveRoom(room.id, target)}
        onCreateFolder={createFolder}
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

export function RoomGrid({
  rooms,
  showLocation = false,
}: {
  rooms: RoomSummary[]
  /** Search results: each tile names the folder it lives in (#807). */
  showLocation?: boolean
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} showLocation={showLocation} />
      ))}
    </div>
  )
}
