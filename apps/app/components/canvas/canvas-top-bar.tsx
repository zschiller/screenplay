"use client"

import { useRouter } from "next/navigation"
import {
  CaretDownIcon,
  DotsThreeIcon,
  GearIcon,
  KeyboardIcon,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { cn } from "@workspace/ui/lib/utils"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { MenuKeys } from "@/components/menu-keys"
import { SHORTCUT_SHEET_KEY } from "@/lib/canvas/shortcuts"
import { deleteRoom } from "@/lib/rooms-actions"
import { withBasePath } from "@/lib/base-path"
import type { PageData } from "@/lib/types"

/**
 * The top-left room-identity pill (PRD #571) — sidebar-expand, the breadcrumb
 * back to the Room's parent folder, the room-name `EditableText`, the room menu
 * (rename / delete / leave), and the delete dialog. While the sidebar is
 * hidden it also carries the current page and its menu (#1839), standing in
 * for the sidebar's Pages section.
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
  onOpenShortcuts,
  stopRoomDevServers,
  flushLayout,
  pages,
  currentPageId,
  onSelectPage,
  onAddPage,
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
  /** Opens the keyboard shortcut sheet, as `?` does (#734). */
  onOpenShortcuts: () => void
  stopRoomDevServers: () => void
  flushLayout: () => Promise<unknown>
  pages: PageData[]
  currentPageId: string
  onSelectPage: (pageId: string) => void
  /** Adds “Page N” and switches to it. */
  onAddPage: () => void
}) {
  const router = useRouter()
  const currentPage = pages.find((p) => p.id === currentPageId)
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
            label="Show sidebar"
            shortcut="⌘B"
            tooltipSide="bottom"
            onClick={() => sidebarPanelRef.current?.expand()}
          >
            <SidebarSimpleIcon />
          </IconButton>
        )}
        <Breadcrumb>
          <BreadcrumbList className="gap-0 text-sm sm:gap-0">
            <BreadcrumbItem className="gap-0">
              <BreadcrumbLink
                href={parentFolder ? `/files/${parentFolder.id}` : "/files"}
                className="max-w-[14rem] truncate px-1.5 py-0.5"
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
            <BreadcrumbItem className="gap-0">
              <EditableText
                ref={roomNameEditableRef}
                as="span"
                value={currentRoomName}
                onCommit={onRoomRename}
                // Only the owner can rename; a collaborator's edit would be
                // refused server-side and snap back.
                disabled={!isOwner}
                placeholder="Untitled"
                className="min-w-0 px-1.5 py-0.5 text-sm text-foreground"
                viewClassName="truncate"
                editClassName={cn(
                  editableTextFieldClass,
                  "mx-1 my-0.5 min-w-0 px-0.5 py-0.5"
                )}
              />
            </BreadcrumbItem>
            {/* The page crumb (#1839): with the sidebar hidden, its Pages
                section moves up here as a menu. */}
            {sidebarCollapsed && currentPage && (
              <>
                <BreadcrumbSeparator className="text-muted-foreground/60">
                  /
                </BreadcrumbSeparator>
                <BreadcrumbItem className="gap-0">
                  <PageMenu
                    pages={pages}
                    currentPage={currentPage}
                    onSelectPage={onSelectPage}
                    onAddPage={onAddPage}
                  />
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbItem className="gap-0 pl-0.5">
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
                  {/* Where Figma's main menu keeps Help ▸ Keyboard shortcuts. */}
                  <DropdownMenuItem onSelect={onOpenShortcuts}>
                    <KeyboardIcon />
                    Keyboard shortcuts
                    <MenuKeys keys={[SHORTCUT_SHEET_KEY]} />
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

/**
 * The page crumb's menu (#1839): the canvas's pages with the current one
 * checked, then New page, which adds “Page N” and switches to it.
 */
function PageMenu({
  pages,
  currentPage,
  onSelectPage,
  onAddPage,
}: {
  pages: PageData[]
  currentPage: PageData
  onSelectPage: (pageId: string) => void
  onAddPage: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Page: ${currentPage.name}`}
          className="flex h-6 max-w-[14rem] min-w-0 items-center gap-0.5 rounded-md px-1.5 text-sm text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-muted [&_svg]:size-4 [&_svg]:shrink-0"
        >
          <span className="truncate">{currentPage.name}</span>
          <CaretDownIcon className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={currentPage.id}
          onValueChange={onSelectPage}
        >
          {pages.map((page) => (
            <DropdownMenuRadioItem key={page.id} value={page.id}>
              {page.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddPage}>New page</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
