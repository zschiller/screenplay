"use client"

import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"
import {
  ChevronRight,
  ChevronsUpDown,
  File as FileIcon,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
} from "lucide-react"
import { signOut, useSession } from "@/lib/auth-client"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { DRAFTS_FOLDER_ID } from "@/lib/organization"
import { useHome, ALL_VIEW_ID } from "./home-provider"
import { InputDialog } from "./file-dialogs"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { FileActionMenu } from "./file-action-menu"
import { FolderActionMenu } from "./folder-action-menu"
import { RepoConfigsDialog } from "./repo-configs-dialog"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { Folder as FolderType } from "@/lib/organization"

function UserHeader() {
  const { data: session, isPending } = useSession()
  const router = useRouter()
  const [configsOpen, setConfigsOpen] = useState(false)

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    )
  }

  const user = session?.user
  const name = user?.name ?? "Account"
  const email = user?.email ?? null
  const initials = (name[0] ?? "?").toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar className="size-7 rounded-md">
              <AvatarImage src={user?.image ?? undefined} alt={name} />
              <AvatarFallback className="rounded-md text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{name}</span>
              {email && (
                <span className="truncate text-xs text-muted-foreground">
                  {email}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-auto size-4 opacity-60" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
        >
          <DropdownMenuLabel className="text-muted-foreground">
            Signed in as {email ?? name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfigsOpen(true)}>
            <LayoutGrid />
            Configured repositories
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={async () => {
              await signOut()
              router.push("/sign-in")
            }}
          >
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RepoConfigsDialog
        open={configsOpen}
        onOpenChange={setConfigsOpen}
      />
    </>
  )
}

function SidebarFileItem({ file }: { file: RoomSummary }) {
  const { renameFile, removeFile } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <SidebarMenuSubItem>
      <div className="group/sub-row relative">
        <SidebarMenuSubButton asChild>
          <a href={`/${file.id}`}>
            <FileIcon />
            <span>{file.name}</span>
          </a>
        </SidebarMenuSubButton>
        <FileActionMenu
          file={file}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onShare={() => setShareOpen(true)}
        >
          <SidebarMenuAction className="md:opacity-0 group-hover/sub-row:opacity-100 group-focus-within/sub-row:opacity-100 aria-expanded:opacity-100">
            <MoreHorizontal />
          </SidebarMenuAction>
        </FileActionMenu>
      </div>
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename file"
        initialValue={file.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFile(file.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareRoomDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          roomId={file.id}
          roomName={file.name}
        />
      )}
    </SidebarMenuSubItem>
  )
}

const FOLDER_OPEN_STORAGE_PREFIX = "home-sidebar:folder-open:"

function readStoredOpen(storageKey: string): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(storageKey) === "1"
}

function SidebarFolderItem({
  folder,
}: {
  folder: FolderType
}) {
  const {
    filesInFolder,
    selectedId,
    setSelectedId,
    renameFolder,
    removeFolder,
  } = useHome()
  const storageKey = `${FOLDER_OPEN_STORAGE_PREFIX}${folder.id}`
  // Read the persisted open state during render instead of in an effect. The
  // lazy initializer runs once on mount, and the previous-value pattern below
  // re-reads localStorage if the storage key changes (e.g. folder.id changes).
  const [open, setOpen] = useState(() => readStoredOpen(storageKey))
  const [storageKeyForOpen, setStorageKeyForOpen] = useState(storageKey)
  if (storageKey !== storageKeyForOpen) {
    setStorageKeyForOpen(storageKey)
    setOpen(readStoredOpen(storageKey))
  }
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const files = filesInFolder(folder.id)
  const isActive = selectedId === folder.id

  const updateOpen = useCallback(
    (next: boolean) => {
      setOpen(next)
      window.localStorage.setItem(storageKey, next ? "1" : "0")
    },
    [storageKey],
  )

  return (
    <Collapsible open={open} onOpenChange={updateOpen} asChild>
      <SidebarMenuItem>
        <div className="group/folder-row relative">
          <SidebarMenuButton
            isActive={isActive}
            onClick={() => {
              setSelectedId(folder.id)
              updateOpen(true)
            }}
          >
            <span className="relative shrink-0">
              <FolderIcon className="block group-hover/folder-row:hidden" />
              <ChevronRight
                onClick={(e) => {
                  e.stopPropagation()
                  updateOpen(!open)
                }}
                className={`hidden size-4 cursor-pointer text-muted-foreground transition-transform group-hover/folder-row:block ${
                  open ? "rotate-90" : ""
                }`}
              />
            </span>
            <span>{folder.name}</span>
          </SidebarMenuButton>
          <FolderActionMenu
            folder={folder}
            onRename={() => setRenameOpen(true)}
            onDelete={() => setDeleteOpen(true)}
          >
            <SidebarMenuAction className="md:opacity-0 group-hover/folder-row:opacity-100 group-focus-within/folder-row:opacity-100 aria-expanded:opacity-100">
              <MoreHorizontal />
            </SidebarMenuAction>
          </FolderActionMenu>
        </div>
        {files.length > 0 && (
          <CollapsibleContent>
            <SidebarMenuSub>
              {files.map((file) => (
                <SidebarFileItem key={file.id} file={file} />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        )}
        <InputDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title="Rename folder"
          initialValue={folder.name}
          submitLabel="Save"
          submittingLabel="Saving…"
          onSubmit={(name) => renameFolder(folder.id, name)}
        />
        <DeleteRoomDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          roomName={folder.name}
          onConfirm={async () => {
            await removeFolder(folder.id)
            setDeleteOpen(false)
          }}
        />
      </SidebarMenuItem>
    </Collapsible>
  )
}

function PinnedFolderItem({ folder }: { folder: FolderType }) {
  const { selectedId, setSelectedId, renameFolder, removeFolder } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={selectedId === folder.id}
        onClick={() => setSelectedId(folder.id)}
      >
        <FolderIcon />
        <span>{folder.name}</span>
      </SidebarMenuButton>
      <FolderActionMenu
        folder={folder}
        onRename={() => setRenameOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      >
        <SidebarMenuAction showOnHover>
          <MoreHorizontal />
        </SidebarMenuAction>
      </FolderActionMenu>
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename folder"
        initialValue={folder.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFolder(folder.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={folder.name}
        onConfirm={async () => {
          await removeFolder(folder.id)
          setDeleteOpen(false)
        }}
      />
    </SidebarMenuItem>
  )
}

function PinnedFileItem({ file }: { file: RoomSummary }) {
  const { renameFile, removeFile } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <a href={`/${file.id}`}>
          <FileIcon />
          <span>{file.name}</span>
        </a>
      </SidebarMenuButton>
      <FileActionMenu
        file={file}
        onRename={() => setRenameOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onShare={() => setShareOpen(true)}
      >
        <SidebarMenuAction showOnHover>
          <MoreHorizontal />
        </SidebarMenuAction>
      </FileActionMenu>
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename file"
        initialValue={file.name}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSubmit={(name) => renameFile(file.id, name)}
      />
      <DeleteRoomDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roomName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareRoomDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          roomId={file.id}
          roomName={file.name}
        />
      )}
    </SidebarMenuItem>
  )
}

export function HomeSidebar() {
  const {
    folders,
    files,
    pinnedFiles,
    pinnedFolders,
    selectedId,
    setSelectedId,
    createFolder,
    loading,
  } = useHome()
  const [newFolderOpen, setNewFolderOpen] = useState(false)

  const pinnedFolderList = folders.filter((f) => pinnedFolders.has(f.id))
  const pinnedFileList = files.filter((f) => pinnedFiles.has(f.id))
  const hasPinned = pinnedFolderList.length + pinnedFileList.length > 0

  return (
    <SidebarProvider className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserHeader />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={selectedId === ALL_VIEW_ID}
                  onClick={() => setSelectedId(ALL_VIEW_ID)}
                >
                  <LayoutGrid />
                  <span>All files</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={selectedId === DRAFTS_FOLDER_ID}
                  onClick={() => setSelectedId(DRAFTS_FOLDER_ID)}
                >
                  <FileText />
                  <span>Drafts</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {hasPinned && (
          <SidebarGroup>
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pinnedFolderList.map((folder) => (
                  <PinnedFolderItem key={folder.id} folder={folder} />
                ))}
                {pinnedFileList.map((file) => (
                  <PinnedFileItem key={file.id} file={file} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Folders</SidebarGroupLabel>
          <SidebarGroupAction
            title="New folder"
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlus />
            <span className="sr-only">New folder</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {folders.map((folder) => (
                <SidebarFolderItem key={folder.id} folder={folder} />
              ))}
              {loading && (
                <SidebarMenuItem>
                  <div className="px-2 py-1.5">
                    <Skeleton className="h-4 w-24" />
                  </div>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <InputDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title="New folder"
        description="Group related files together."
        placeholder="Folder name"
        submitLabel="Create"
        submittingLabel="Creating…"
        onSubmit={async (name) => {
          await createFolder(name)
        }}
      />
    </SidebarProvider>
  )
}
