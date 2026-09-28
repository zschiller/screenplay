"use client"

import { useState } from "react"
import { Brain, FolderGit2, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import {
  AddRepositoryDialog,
  AddRepositoryMenuItems,
  useAddRepositoryFlow,
} from "@/components/add-repository-dialog"
import { SettingsRow, SettingsRowList } from "@/components/home/settings-row"
import { RemoveRepositoryDialog } from "@/components/remove-repository-dialog"
import type { RepoPickerSelection } from "@/components/repo-picker"
import { RepoSettingsDialog } from "@/components/repo-settings-dialog"
import type { ResolvedRepoSettings } from "@/lib/add-repo/resolver"
import { isLocalBuild } from "@/lib/local-mode"
import { repoShortName, repoSource } from "@/lib/repo-identity"
import { sortForSidebar } from "@/lib/sidebar-order"
import type { BranchData, MemoryData, RepoData } from "@/lib/types"
import { MemorySection } from "./canvas-memory-section"

/** The sections of Canvas settings. Members may join later. */
export type CanvasSettingsSection = "repositories" | "memory"

const SECTIONS: {
  id: CanvasSettingsSection
  title: string
  icon: typeof FolderGit2
}[] = [
  { id: "repositories", title: "Repositories", icon: FolderGit2 },
  { id: "memory", title: "Memory", icon: Brain },
]

/**
 * Canvas settings (#883): the canvas-wide setup, opened from the canvas name's
 * … menu. Built on shadcn's settings-dialog block (a sidebar of sections in a
 * dialog). Its first section, Repositories, lists the code the canvas runs and
 * adds, edits and removes it through the same flows as the sidebar. What it
 * edits lives in the Room's Y.Doc, so every collaborator shares it. Memory
 * (#902) lists the canvas memory every chat reads.
 */
export function CanvasSettingsDialog({
  open,
  onOpenChange,
  repos,
  branches,
  onCreateRepo,
  onUpdateRepo,
  onRemoveRepo,
  memories,
  onAddMemory,
  onEditMemory,
  onRemoveMemory,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: RepoData[]
  branches: BranchData[]
  /** Canvas memory entries, oldest first. */
  memories: MemoryData[]
  onAddMemory: (text: string) => void
  onEditMemory: (id: string, text: string) => void
  onRemoveMemory: (id: string) => void
  onCreateRepo: (
    pick: RepoPickerSelection,
    settings?: ResolvedRepoSettings
  ) => void
  onUpdateRepo: (id: string, data: Partial<RepoData>) => void
  onRemoveRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => void | Promise<void>
}) {
  const [activeId, setActiveId] =
    useState<CanvasSettingsSection>("repositories")
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]!
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px]"
        // Focus the dialog itself rather than its first control, so opening
        // doesn't paint a focus ring on the section list.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).focus()
        }}
      >
        <DialogTitle className="sr-only">Canvas settings</DialogTitle>
        <DialogDescription className="sr-only">
          Set up the code this canvas runs and what every chat on it remembers.
        </DialogDescription>
        <SidebarProvider className="min-h-0 items-start">
          <Sidebar collapsible="none" className="hidden w-48 md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SECTIONS.map((section) => (
                      <SidebarMenuItem key={section.id}>
                        <SidebarMenuButton
                          isActive={section.id === active.id}
                          onClick={() => setActiveId(section.id)}
                        >
                          <section.icon />
                          <span>{section.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[440px] flex-1 flex-col overflow-hidden">
            {/* 48px tall, so the breadcrumb centres on the same line as the
                first section and the close button. */}
            <header className="flex h-12 shrink-0 items-center px-5">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    Canvas settings
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{active.title}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
              {active.id === "memory" ? (
                <MemorySection
                  memories={memories}
                  onAddMemory={onAddMemory}
                  onEditMemory={onEditMemory}
                  onRemoveMemory={onRemoveMemory}
                />
              ) : (
                <RepositoriesSection
                  repos={repos}
                  branches={branches}
                  onCreateRepo={onCreateRepo}
                  onUpdateRepo={onUpdateRepo}
                  onRemoveRepo={onRemoveRepo}
                />
              )}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The Repositories section: one row per Repo (short name over its source),
 * with Edit and a menu holding Remove, like the rows of Repository presets.
 */
function RepositoriesSection({
  repos,
  branches,
  onCreateRepo,
  onUpdateRepo,
  onRemoveRepo,
}: {
  repos: RepoData[]
  branches: BranchData[]
  onCreateRepo: (
    pick: RepoPickerSelection,
    settings?: ResolvedRepoSettings
  ) => void
  onUpdateRepo: (id: string, data: Partial<RepoData>) => void
  onRemoveRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => void | Promise<void>
}) {
  const addRepository = useAddRepositoryFlow()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  // The sidebar's order, so both lists read the same way.
  const sorted = sortForSidebar(repos, (a, b) =>
    a.repoFullName.localeCompare(b.repoFullName)
  )

  const addButton = isLocalBuild ? (
    // Desktop: a menu first, like the sidebar's Add repository (#604).
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus />
          Add repository
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Both items open a dialog (or the native folder picker); handing
        // focus back to the trigger would pull it out of that dialog.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <AddRepositoryMenuItems flow={addRepository} />
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <Button size="sm" onClick={addRepository.openGitHub}>
      <Plus />
      Add repository
    </Button>
  )

  return (
    <>
      <p className="text-sm text-muted-foreground">
        The code this canvas runs, and how to run it.
        {isLocalBuild
          ? " New workspaces start from these settings."
          : " Shared with everyone on this canvas, so their new workspaces start from the same settings."}
      </p>
      {sorted.length === 0 ? (
        <Empty className="flex-none border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderGit2 />
            </EmptyMedia>
            <EmptyTitle>No repositories yet</EmptyTitle>
            <EmptyDescription>
              Workspaces run a repository&apos;s code. Add one to start a
              workspace on this canvas.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addButton}</EmptyContent>
        </Empty>
      ) : (
        <>
          <SettingsRowList>
            {sorted.map((repo) => (
              <SettingsRow
                key={repo.id}
                title={repoShortName(repo)}
                detail={repoSource(repo)}
                action={
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Edit ${repoShortName(repo)}`}
                      onClick={() => setEditingId(repo.id)}
                    >
                      Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={`More actions for ${repoShortName(repo)}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onCloseAutoFocus={(event) => event.preventDefault()}
                      >
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setRemovingId(repo.id)}
                        >
                          <Trash2 />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            ))}
          </SettingsRowList>
          <div className="flex justify-end">{addButton}</div>
        </>
      )}
      <AddRepositoryDialog flow={addRepository} onCreateRepo={onCreateRepo} />
      <RepoSettingsDialog
        repo={repos.find((r) => r.id === editingId) ?? null}
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
        onUpdate={onUpdateRepo}
      />
      <RemoveRepositoryDialog
        repo={repos.find((r) => r.id === removingId) ?? null}
        branches={branches}
        onOpenChange={(open) => {
          if (!open) setRemovingId(null)
        }}
        onRemoveRepo={onRemoveRepo}
      />
    </>
  )
}
