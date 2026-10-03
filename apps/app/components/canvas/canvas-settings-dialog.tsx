"use client"

import { useEffect, useState } from "react"
import {
  BookBookmarkIcon,
  BrainIcon,
  PlusIcon,
} from "@workspace/ui/components/icons"
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
import { Switch } from "@workspace/ui/components/switch"
import {
  AddRepositoryDialog,
  AddRepositoryMenuItems,
  useAddRepositoryFlow,
} from "@/components/add-repository-dialog"
import { LoadErrorRow } from "@/components/home/load-error"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "@/components/home/settings-row"
import { RemoveRepositoryDialog } from "@/components/remove-repository-dialog"
import type { RepoPickerSelection } from "@/components/repo-picker"
import { RepoSettingsDialog } from "@/components/repo-settings-dialog"
import type { ResolvedRepoSettings } from "@/lib/add-repo/resolver"
import { isLocalBuild } from "@/lib/local-mode"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { repoShortName } from "@/lib/repo-identity"
import { canvasRepositoryRows } from "@/lib/repository-library"
import { listRepositories } from "@/lib/repository-library/actions"
import type { BranchData, MemoryData, RepoData } from "@/lib/types"
import { MemorySection } from "./canvas-memory-section"

/** The sections of Canvas settings. Members may join later. */
export type CanvasSettingsSection = "repositories" | "memory"

const SECTIONS: {
  id: CanvasSettingsSection
  title: string
  icon: typeof BookBookmarkIcon
}[] = [
  { id: "repositories", title: "Repositories", icon: BookBookmarkIcon },
  { id: "memory", title: "Memory", icon: BrainIcon },
]

/**
 * Canvas settings (#883): the canvas-wide setup, opened from the canvas name's
 * … menu. Built on shadcn's settings-dialog block (a sidebar of sections in a
 * dialog). Its first section, Repositories, lists your repositories with a
 * switch for whether this canvas runs each, and edits them through the same
 * flows as the sidebar. What it edits lives in the Room's Y.Doc, so every
 * collaborator shares it. Memory (#902) lists the canvas memory every chat
 * reads.
 */
export function CanvasSettingsDialog({
  open,
  onOpenChange,
  repos,
  branches,
  onCreateRepo,
  onUpdateRepo,
  onRemoveRepo,
  onSwitchOn,
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
  /** Turn one of your Repositories on for this canvas (#1422). */
  onSwitchOn: (repository: RepoConfig) => void
}) {
  const [activeId, setActiveId] =
    useState<CanvasSettingsSection>("repositories")
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]!
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] [&>[data-slot=dialog-close]]:top-2.5"
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
        <SidebarProvider className="min-h-0 min-w-0 items-start">
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
          <main className="flex h-[440px] min-w-0 flex-1 flex-col overflow-hidden">
            {/* 48px tall, so the breadcrumb centres on the same line as the
                first section and the close button. */}
            <header className="flex h-12 shrink-0 items-center px-5">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    Canvas settings
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden text-muted-foreground/60 md:block">
                    /
                  </BreadcrumbSeparator>
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
                  onSwitchOn={onSwitchOn}
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
 * The Repositories section (#1422): every one of your Repositories with a
 * switch for whether this canvas uses it, plus the canvas's other Repos
 * (unlinked, or a member's) switched on. Each row's subtitle is its run
 * scripts. Turning one off goes through today's remove path, confirming first
 * when Workspaces use it.
 */
function RepositoriesSection({
  repos,
  branches,
  onCreateRepo,
  onUpdateRepo,
  onRemoveRepo,
  onSwitchOn,
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
  onSwitchOn: (repository: RepoConfig) => void
}) {
  const addRepository = useAddRepositoryFlow()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [turningOffId, setTurningOffId] = useState<string | null>(null)
  // Your Repositories; until they load, the canvas's own Repos list alone.
  const [repositories, setRepositories] = useState<RepoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    listRepositories()
      .then((list) => {
        if (!cancelled) setRepositories(list)
      })
      .catch((err) => {
        console.error("Failed to load repositories", err)
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const reload = async () => {
    setRepositories(await listRepositories())
    setLoadFailed(false)
  }

  const rows = canvasRepositoryRows(repositories, repos)

  const switchOff = (repo: RepoData) => {
    if (branches.some((b) => b.repoId === repo.id)) setTurningOffId(repo.id)
    else void onRemoveRepo(repo.id, { deleteBranchesOnRemote: false })
  }

  const addButton = isLocalBuild ? (
    // Desktop: a menu first, like the sidebar's Add repository (#604).
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <PlusIcon />
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
      <PlusIcon />
      Add repository
    </Button>
  )

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {isLocalBuild
          ? "Your repositories. Turn one on to run it on this canvas; new workspaces start from its settings."
          : "Your repositories and the ones on this canvas. Turn one on to share it with everyone here; their new workspaces start from its settings."}
      </p>
      {loadFailed && (
        <LoadErrorRow
          title="Couldn't load your repositories"
          onRetry={reload}
        />
      )}
      {rows.length === 0 && loading ? (
        <SettingsRowSkeleton label="Loading repositories…" count={2} />
      ) : rows.length === 0 ? (
        <Empty className="flex-none border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookBookmarkIcon />
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
            {rows.map((row) => {
              const source = row.on ? row.repo : row.repository
              const name = repoShortName(source)
              return (
                <SettingsRow
                  key={row.on ? row.repo.id : row.repository.id}
                  title={name}
                  detail={<RunScripts source={source} />}
                  action={
                    <>
                      {row.on && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Edit ${name}`}
                          onClick={() => setEditingId(row.repo.id)}
                        >
                          Edit
                        </Button>
                      )}
                      <Switch
                        aria-label={`Use ${name} on this canvas`}
                        checked={row.on}
                        onCheckedChange={(on) => {
                          if (on && !row.on) onSwitchOn(row.repository)
                          else if (!on && row.on) switchOff(row.repo)
                        }}
                      />
                    </>
                  }
                />
              )
            })}
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
        verb="Turn off"
        repo={repos.find((r) => r.id === turningOffId) ?? null}
        branches={branches}
        onOpenChange={(open) => {
          if (!open) setTurningOffId(null)
        }}
        onRemoveRepo={onRemoveRepo}
      />
    </>
  )
}

/** A row's subtitle: how it runs, its setup and dev scripts in mono. */
function RunScripts({
  source,
}: {
  source: { setupScript: string; devScript: string }
}) {
  const scripts = [source.setupScript, source.devScript]
    .map((s) => s.trim())
    .filter(Boolean)
  if (scripts.length === 0) return "No scripts set"
  return scripts.map((script, i) => (
    <span key={i}>
      {i > 0 && <span className="mx-1">·</span>}
      <code className="font-mono text-xs">{script}</code>
    </span>
  ))
}
