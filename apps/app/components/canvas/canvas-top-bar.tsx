"use client"

import { useRouter } from "next/navigation"
import {
  DotsThreeIcon,
  GearIcon,
  PencilSimpleIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"

import { IconButton } from "@workspace/ui/components/icon-button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  EditableText,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { deleteRoom } from "@/lib/rooms-actions"
import { withBasePath } from "@/lib/base-path"

/**
 * The top-left room-identity pill (PRD #571) — sidebar-expand, the breadcrumb
 * back to the Room's parent folder, the room-name `EditableText`, the room menu
 * (rename / delete / leave), and the delete dialog.
 *
 * A small self-contained room-identity cluster: no controller of its own, but
 * separable from the canvas it floats over. It takes the room identity
 * (name / rename / owner / share count), the panel refs it drives, and
 * `flushLayout` — flushed before the breadcrumb's hard navigation so the home
 * grid re-renders from a fresh thumbnail manifest rather than a stale one.
 */
export function CanvasTopBar({
  roomId,
  isOwner,
  sharedWithCount,
  parentFolder,
  currentRoomName,
  onRoomRename,
  sidebarCollapsed,
  trafficLightsPresent,
  sidebarPanelRef,
  roomNameEditableRef,
  pendingRoomRenameRef,
  onRoomMenuCloseAutoFocus,
  deleteDialogOpen,
  onDeleteDialogOpenChange,
  onOpenSettings,
  stopRoomDevServers,
  flushLayout,
}: {
  roomId: string
  isOwner: boolean
  sharedWithCount: number
  parentFolder: { id: string; name: string } | null
  currentRoomName: string
  onRoomRename: (next: string) => void
  sidebarCollapsed: boolean
  trafficLightsPresent: boolean
  sidebarPanelRef: React.RefObject<PanelImperativeHandle | null>
  roomNameEditableRef: React.RefObject<EditableTextHandle | null>
  pendingRoomRenameRef: React.MutableRefObject<boolean>
  onRoomMenuCloseAutoFocus: (e: Event) => void
  deleteDialogOpen: boolean
  onDeleteDialogOpenChange: (open: boolean) => void
  /** Opens Canvas settings (#883). */
  onOpenSettings: () => void
  stopRoomDevServers: () => void
  flushLayout: () => Promise<unknown>
}) {
  const router = useRouter()
  return (
    <div
      className={`pointer-events-none absolute top-0 left-0 z-(--z-canvas-chrome) flex h-12 items-center pr-2 ${
        // When the macOS traffic lights are showing (desktop, not
        // fullscreen) and the sidebar is collapsed, the canvas fills the
        // full width — shift these pills right to clear the lights.
        trafficLightsPresent && sidebarCollapsed ? "pl-[88px]" : "pl-2"
      }`}
    >
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/10 [&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        {sidebarCollapsed && (
          <IconButton
            label="Expand sidebar"
            shortcut="⌘B"
            tooltipSide="bottom"
            onClick={() => sidebarPanelRef.current?.expand()}
          >
            <SidebarSimpleIcon />
          </IconButton>
        )}
        <Breadcrumb>
          <BreadcrumbList className="gap-0 text-xs sm:gap-0">
            <BreadcrumbItem className="gap-0">
              <BreadcrumbLink
                href={parentFolder ? `/files/${parentFolder.id}` : "/files"}
                className="max-w-[14rem] truncate px-1.5 py-1 font-medium"
                onClick={(e) => {
                  e.preventDefault()
                  stopRoomDevServers()
                  const target = withBasePath(
                    parentFolder ? `/files/${parentFolder.id}` : "/files"
                  )
                  // Full-page navigation (not router.push): a soft nav
                  // serves the home page from the client Router Cache,
                  // which is the copy captured when we ENTERED the room —
                  // so a layout edit made in here shows up stale on the
                  // grid. A hard navigation re-renders home from the
                  // server (fresh thumbnail manifest) every time.
                  //
                  // But a full-page unload skips React's unmount cleanup,
                  // so flush the pending layout edit FIRST and await it
                  // (the route rebuilds the manifest inline) — otherwise
                  // the last edit never reaches the server and the fresh
                  // render is still stale. `.finally` so a failed flush
                  // still navigates rather than trapping the user.
                  void flushLayout().finally(() =>
                    window.location.assign(target)
                  )
                }}
              >
                {parentFolder ? parentFolder.name : "All files"}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-muted-foreground/60">
              /
            </BreadcrumbSeparator>
            <BreadcrumbItem className="gap-0.5">
              <EditableText
                ref={roomNameEditableRef}
                as="span"
                value={currentRoomName}
                onCommit={onRoomRename}
                // Only the owner can rename; a collaborator's edit would be
                // refused server-side and snap back.
                disabled={!isOwner}
                placeholder="Untitled"
                className="min-w-0 px-1.5 py-1 text-xs font-medium text-foreground"
                viewClassName="truncate"
                editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 mx-1 my-0.5"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label="Canvas options"
                    tooltipSide="bottom"
                    className="text-muted-foreground"
                  >
                    <DotsThreeIcon />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  onCloseAutoFocus={onRoomMenuCloseAutoFocus}
                >
                  {/* Only the owner can rename; a collaborator's
                      rename would be refused server-side. */}
                  {isOwner && (
                    <DropdownMenuItem
                      onSelect={() => {
                        pendingRoomRenameRef.current = true
                      }}
                    >
                      <PencilSimpleIcon />
                      Rename
                    </DropdownMenuItem>
                  )}
                  {/* Everyone on the canvas can edit its repositories, as
                      from the sidebar. */}
                  <DropdownMenuItem onSelect={onOpenSettings}>
                    <GearIcon />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {isOwner && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDeleteDialogOpenChange(true)}
                    >
                      <TrashIcon />
                      Delete
                    </DropdownMenuItem>
                  )}
                  {/* A shared Room the user doesn't own: they leave it
                      rather than destroy it for everyone else. */}
                  {!isOwner && (
                    <DropdownMenuItem
                      onSelect={() => onDeleteDialogOpenChange(true)}
                    >
                      <SignOutIcon />
                      Leave
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <DeleteRoomDialog
          open={deleteDialogOpen}
          onOpenChange={onDeleteDialogOpenChange}
          roomName={currentRoomName}
          isOwner={isOwner}
          sharedWithCount={sharedWithCount}
          onConfirm={async () => {
            await deleteRoom(roomId)
            onDeleteDialogOpenChange(false)
            router.push("/")
          }}
        />
      </div>
    </div>
  )
}
