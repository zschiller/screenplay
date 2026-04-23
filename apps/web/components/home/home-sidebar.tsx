"use client"

import { useState } from "react"
import { useUser, useClerk } from "@clerk/nextjs"
import {
  ChevronDown,
  ChevronsUpDown,
  File as FileIcon,
  Folder as FolderIcon,
  FolderPlus,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Pin,
  Plus,
  Settings,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { DRAFTS_FOLDER_ID } from "@/lib/organization"
import { useHome, ALL_VIEW_ID } from "./home-provider"
import { InputDialog } from "./file-dialogs"
import { DeleteProjectDialog } from "@/components/delete-project-dialog"
import { ShareProjectDialog } from "@/components/share-project-dialog"
import { FileActionMenu } from "./file-action-menu"
import { FolderActionMenu } from "./folder-action-menu"
import { WorkspaceConfigsDialog } from "./workspace-configs-dialog"
import type { ProjectSummary } from "@/lib/projects-actions"
import type { Folder as FolderType } from "@/lib/organization"

function UserHeader() {
  const { user, isLoaded } = useUser()
  const { openUserProfile, signOut } = useClerk()
  const [configsOpen, setConfigsOpen] = useState(false)

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    )
  }

  const name =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.username ?? user?.firstName ?? "Account"
  const email = user?.primaryEmailAddress?.emailAddress ?? null
  const initials = (user?.firstName?.[0] ?? name[0] ?? "?").toUpperCase()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar className="size-7 rounded-md">
              <AvatarImage src={user?.imageUrl} alt={name} />
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
          <DropdownMenuItem onSelect={() => openUserProfile()}>
            <Settings />
            Account settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfigsOpen(true)}>
            <LayoutGrid />
            Configured repositories
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <WorkspaceConfigsDialog
        open={configsOpen}
        onOpenChange={setConfigsOpen}
      />
    </>
  )
}

function SidebarFileItem({ file }: { file: ProjectSummary }) {
  const { renameFile, removeFile } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild>
        <a href={`/${file.id}`} target="_blank" rel="noopener noreferrer">
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
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareProjectDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={file.id}
          projectName={file.name}
        />
      )}
    </SidebarMenuSubItem>
  )
}

function SidebarFolderItem({
  folder,
  isDrafts = false,
}: {
  folder: FolderType | { id: string; name: string }
  isDrafts?: boolean
}) {
  const {
    filesInFolder,
    selectedId,
    setSelectedId,
    renameFolder,
    removeFolder,
  } = useHome()
  const [open, setOpen] = useState(isDrafts)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const files = filesInFolder(folder.id)
  const isActive = selectedId === folder.id

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isActive}
          onClick={() => {
            setSelectedId(folder.id)
            setOpen(true)
          }}
        >
          <FolderIcon />
          <span>{folder.name}</span>
          <ChevronDown
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
            className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
        </SidebarMenuButton>
        {!isDrafts && "createdAt" in folder && (
          <FolderActionMenu
            folder={folder as FolderType}
            onRename={() => setRenameOpen(true)}
            onDelete={() => setDeleteOpen(true)}
          >
            <SidebarMenuAction showOnHover className="right-7">
              <MoreHorizontal />
            </SidebarMenuAction>
          </FolderActionMenu>
        )}
        <CollapsibleContent>
          <SidebarMenuSub>
            {files.length === 0 ? (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-xs text-muted-foreground">
                  Empty
                </span>
              </SidebarMenuSubItem>
            ) : (
              files.map((file) => (
                <SidebarFileItem key={file.id} file={file} />
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
        {!isDrafts && "createdAt" in folder && (
          <>
            <InputDialog
              open={renameOpen}
              onOpenChange={setRenameOpen}
              title="Rename folder"
              initialValue={folder.name}
              submitLabel="Save"
              submittingLabel="Saving…"
              onSubmit={(name) => renameFolder(folder.id, name)}
            />
            <DeleteProjectDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              projectName={folder.name}
              onConfirm={async () => {
                await removeFolder(folder.id)
                setDeleteOpen(false)
              }}
            />
          </>
        )}
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
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectName={folder.name}
        onConfirm={async () => {
          await removeFolder(folder.id)
          setDeleteOpen(false)
        }}
      />
    </SidebarMenuItem>
  )
}

function PinnedFileItem({ file }: { file: ProjectSummary }) {
  const { renameFile, removeFile } = useHome()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <a href={`/${file.id}`} target="_blank" rel="noopener noreferrer">
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
      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectName={file.name}
        onConfirm={async () => {
          await removeFile(file.id)
          setDeleteOpen(false)
        }}
      />
      {shareOpen && (
        <ShareProjectDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          projectId={file.id}
          projectName={file.name}
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
    <Sidebar collapsible="offcanvas">
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {hasPinned && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Pin className="mr-1.5" />
              Pinned
            </SidebarGroupLabel>
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
              <SidebarFolderItem
                folder={{ id: DRAFTS_FOLDER_ID, name: "Drafts" }}
                isDrafts
              />
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

      <SidebarFooter>
        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          onClick={() => setNewFolderOpen(true)}
        >
          <Plus />
          New folder
        </Button>
      </SidebarFooter>

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
    </Sidebar>
  )
}
