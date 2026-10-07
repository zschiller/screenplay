"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  BookBookmarkIcon,
  BookOpenIcon,
  FolderIcon,
  NotepadIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  AddRepositoryDialog,
  NewRepositoryButton,
  useAddRepositoryFlow,
} from "@/components/add-repository-dialog"
import { LoadErrorRow } from "@/components/home/load-error"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "@/components/home/settings-row"
import { RemoveRepositoryDialog } from "@/components/remove-repository-dialog"
import { RepoSettingsDialog } from "@/components/repo-settings-dialog"
import { RepoTitle } from "@/components/repo-title"
import { NeedsYouDot } from "@/components/workspace-mention"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { repoShortName } from "@/lib/repo-identity"
import {
  canvasRepositoryGroups,
  canvasRepositoryRows,
  repositoryLinkPolicy,
  type RepositoryLinkPolicy,
} from "@/lib/repository-library"
import {
  listRepositories,
  saveRepositoryToAll,
} from "@/lib/repository-library/actions"
import { listCollaborators, type CollaboratorInfo } from "@/lib/rooms-actions"
import type {
  BranchData,
  FileEntryData,
  MemoryData,
  RepoData,
} from "@/lib/types"
import type { SavedSkill } from "@/lib/skills/saved"
import { deleteCanvasFile, FilesSection } from "./canvas-files-section"
import { MemorySection } from "./canvas-memory-section"
import { CanvasSkillsSection } from "./canvas-skills-section"
import { openCanvasFileOnDesktop } from "@/lib/files/desktop-actions"
import { isLocalBuild } from "@/lib/local-mode"
import { DialogScrollBody } from "@/components/scroll-hairline"

/** The sections of Canvas settings. Members may join later. */
export type CanvasSettingsSection =
  "repositories" | "memory" | "files" | "skills"

const SECTIONS: {
  id: CanvasSettingsSection
  title: string
  icon: typeof BookBookmarkIcon
}[] = [
  { id: "repositories", title: "Repositories", icon: BookBookmarkIcon },
  { id: "memory", title: "Memory", icon: NotepadIcon },
  { id: "files", title: "Files", icon: FolderIcon },
  { id: "skills", title: "Skills", icon: BookOpenIcon },
]

/**
 * Canvas settings (#883): the canvas-wide setup, opened from the canvas name's
 * … menu. Built on shadcn's settings-dialog block (a sidebar of sections in a
 * dialog). Its first section, Repositories, lists the canvas's repositories
 * and your others to add, and edits them through the same flows as the
 * sidebar. What it edits lives in the Room's Y.Doc, so every
 * collaborator shares it. Memory (#902) lists the canvas memory every chat
 * reads, Files (#1517) the files every chat can open, and Skills (#1557)
 * the Skills chats saved here.
 */
export function CanvasSettingsDialog({
  roomId,
  canRevealEnv,
  open,
  onOpenChange,
  userId,
  repos,
  branches,
  onUpdateRepo,
  onRemoveRepo,
  onSwitchOn,
  memories,
  onAddMemory,
  onEditMemory,
  onRemoveMemory,
  files,
  deleteFile = deleteCanvasFile,
  openFileOnDesktop = isLocalBuild ? openCanvasFileOnDesktop : undefined,
  skills,
  policy = repositoryLinkPolicy,
}: {
  roomId: string
  /** Whether this person may reveal a Repo's env var values (#1416). */
  canRevealEnv: (repo: RepoData) => boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** You, for telling the Repos you added from a teammate's (hosted). */
  userId: string | undefined
  repos: RepoData[]
  branches: BranchData[]
  /** Canvas memory entries, oldest first. */
  memories: MemoryData[]
  onAddMemory: (text: string) => void
  onEditMemory: (id: string, text: string) => void
  onRemoveMemory: (id: string) => void
  /** Canvas Files entries (#1517), in any order. */
  files: FileEntryData[]
  /** Delete a file or folder for every member; the route unless a test
   *  picks one. */
  deleteFile?: (roomId: string, path: string) => Promise<void>
  /** The desktop's Open and Reveal in Finder (#1517); absent on hosted
   *  unless a test picks one. */
  openFileOnDesktop?: (
    roomId: string,
    path: string,
    how: "open" | "reveal"
  ) => Promise<void>
  /** The canvas's saved Skills, by name. */
  skills: SavedSkill[]
  onUpdateRepo: (id: string, data: Partial<RepoData>) => void
  onRemoveRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => void | Promise<void>
  /** Turn one of your Repositories on for this canvas (#1422); New
   *  repository saves one and turns it on here (#1423). */
  onSwitchOn: (repository: RepoConfig) => void
  /** Whether Canvas Repos follow their Repository; this build's unless a
   *  test picks one. */
  policy?: RepositoryLinkPolicy
}) {
  const [activeId, setActiveId] =
    useState<CanvasSettingsSection>("repositories")
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]!
  const members = useCanvasMembers(
    roomId,
    policy.showsAddedBy && active.id === "files"
  )
  const adderName = (entry: FileEntryData) =>
    entry.addedBy === "agent"
      ? "Saved by agent"
      : entry.addedById === userId
        ? "Added by you"
        : `Added by ${members.find((m) => m.userId === entry.addedById)?.name ?? "a member"}`
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
            <DialogScrollBody
              wrapperClassName="flex min-h-0 flex-1 flex-col"
              className="flex flex-1 flex-col gap-4 px-5 pb-5"
            >
              {active.id === "skills" ? (
                <CanvasSkillsSection roomId={roomId} skills={skills} />
              ) : active.id === "files" ? (
                <FilesSection
                  roomId={roomId}
                  files={files}
                  onDelete={(path) => deleteFile(roomId, path)}
                  onDesktop={
                    openFileOnDesktop &&
                    ((path, how) => openFileOnDesktop(roomId, path, how))
                  }
                  adderName={adderName}
                />
              ) : active.id === "memory" ? (
                <MemorySection
                  memories={memories}
                  onAddMemory={onAddMemory}
                  onEditMemory={onEditMemory}
                  onRemoveMemory={onRemoveMemory}
                />
              ) : (
                <RepositoriesSection
                  roomId={roomId}
                  canRevealEnv={canRevealEnv}
                  userId={userId}
                  repos={repos}
                  branches={branches}
                  onUpdateRepo={onUpdateRepo}
                  onRemoveRepo={onRemoveRepo}
                  onSwitchOn={onSwitchOn}
                  policy={policy}
                />
              )}
            </DialogScrollBody>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The Repositories section (#1422): On this canvas (every Canvas Repo, linked
 * to one of your Repositories or not) with Edit and Remove, then Your other
 * repositories with Add. Each row's subtitle is its run scripts. Remove goes
 * through today's remove path, confirming first when the policy says so.
 * Desktop: Edit changes this canvas only, unless its Save to all box is ticked
 * (#1425), and a Repo that differs from its Repository gets an orange dot
 * (#1424). Hosted diverges (#1427): a shared canvas shows who added each Repo,
 * and a Repo is the canvas's own copy once added, with no dot, Reset or Save
 * to all.
 */
function RepositoriesSection({
  roomId,
  canRevealEnv,
  userId,
  repos,
  branches,
  onUpdateRepo,
  onRemoveRepo,
  onSwitchOn,
  policy,
}: {
  roomId: string
  canRevealEnv: (repo: RepoData) => boolean
  userId: string | undefined
  repos: RepoData[]
  branches: BranchData[]
  onUpdateRepo: (id: string, data: Partial<RepoData>) => void
  onRemoveRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => void | Promise<void>
  onSwitchOn: (repository: RepoConfig) => void
  policy: RepositoryLinkPolicy
}) {
  const addRepository = useAddRepositoryFlow()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
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

  const members = useCanvasMembers(roomId, policy.showsAddedBy)
  const rows = canvasRepositoryRows(repositories, repos)
  // Who added each Repo only means something once someone else is here.
  const shared = members.length > 1
  const member = (id: string | undefined) =>
    id ? members.find((m) => m.userId === id) : undefined

  const editing = repos.find((r) => r.id === editingId) ?? null
  const removing = repos.find((r) => r.id === removingId) ?? null
  const groups = canvasRepositoryGroups(rows)

  const remove = (repo: RepoData) => {
    if (policy.removeConfirms(repo, branches, repositories)) {
      setRemovingId(repo.id)
    } else void onRemoveRepo(repo.id, { deleteBranchesOnRemote: false })
  }

  const newButton = <NewRepositoryButton flow={addRepository} />

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {policy.propagatesEdits
          ? "The repositories on this canvas. Add one of yours to run it here; it follows your Settings until you edit it here."
          : "The repositories on this canvas, shared with everyone here. Add one of yours to copy its settings here."}
      </p>
      {loadFailed && (
        <LoadErrorRow
          title="Couldn’t load your repositories"
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
              Add one to start chats that work on its code.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newButton}</EmptyContent>
        </Empty>
      ) : (
        <>
          {groups.map((group) => (
            <section
              key={group.label}
              aria-label={group.label}
              className="flex flex-col gap-2"
            >
              <h3 className="text-xs font-medium text-muted-foreground">
                {group.label}
              </h3>
              <SettingsRowList>
                {group.rows.map((row) => {
                  const source = row.on ? row.repo : row.repository
                  const name = repoShortName(source)
                  const customized =
                    row.on && policy.isCustomized(row.repo, repositories)
                  // Who added it, on a shared canvas, when it wasn't you.
                  const adder =
                    shared && row.on && row.repo.addedBy !== userId
                      ? member(row.repo.addedBy)
                      : undefined
                  return (
                    <SettingsRow
                      key={row.on ? row.repo.id : row.repository.id}
                      title={<RepoTitle repo={source} />}
                      marker={
                        customized ? (
                          <CustomizedDot />
                        ) : (
                          adder && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              Added by {adder.name}
                            </span>
                          )
                        )
                      }
                      detail={<RunScripts source={source} />}
                      action={
                        <>
                          {row.on && (
                            <IconButton
                              label={`Edit ${name}`}
                              onClick={() => setEditingId(row.repo.id)}
                            >
                              <PencilSimpleIcon />
                            </IconButton>
                          )}
                          {row.on ? (
                            <IconButton
                              label={`Remove ${name}`}
                              onClick={() => remove(row.repo)}
                            >
                              <TrashIcon />
                            </IconButton>
                          ) : (
                            <IconButton
                              label={`Add ${name}`}
                              onClick={() => onSwitchOn(row.repository)}
                            >
                              <PlusIcon />
                            </IconButton>
                          )}
                        </>
                      }
                    />
                  )
                })}
              </SettingsRowList>
            </section>
          ))}
          {/* Where these come from: the list in Settings, with Duplicate and
              Delete, says how many canvases use each (H5). */}
          <div className="flex items-center justify-between gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-2.5 text-muted-foreground"
            >
              <Link href="/settings?section=repositories">
                Manage in Settings
              </Link>
            </Button>
            <NewRepositoryButton flow={addRepository} variant="outline" />
          </div>
        </>
      )}
      <AddRepositoryDialog
        flow={addRepository}
        onAdded={(repository, list) => {
          setRepositories(list)
          onSwitchOn(repository)
        }}
      />
      <RepoSettingsDialog
        roomId={roomId}
        canRevealEnv={editing ? canRevealEnv(editing) : false}
        repo={editing}
        repository={
          editing ? policy.followedRepository(editing, repositories) : undefined
        }
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
        onUpdate={onUpdateRepo}
        onSaveToAll={async (repository) => {
          setRepositories(await saveRepositoryToAll(repository))
        }}
      />
      <RemoveRepositoryDialog
        repo={removing}
        forEveryone={policy.removesForEveryone}
        addedByName={
          shared && removing && removing.addedBy !== userId
            ? member(removing.addedBy)?.name
            : undefined
        }
        branches={branches}
        changesLost={
          removing ? policy.isCustomized(removing, repositories) : false
        }
        onOpenChange={(open) => {
          if (!open) setRemovingId(null)
        }}
        onRemoveRepo={onRemoveRepo}
      />
    </>
  )
}

/** The canvas's members, for naming who added each Repo, when the policy
 *  names them (the desktop canvas is always yours). A failed fetch just
 *  names no one. */
function useCanvasMembers(
  roomId: string,
  enabled: boolean
): CollaboratorInfo[] {
  const [members, setMembers] = useState<CollaboratorInfo[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    listCollaborators(roomId)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch((err) => console.error("listCollaborators failed:", err))
    return () => {
      cancelled = true
    }
  }, [roomId, enabled])
  return members
}

/** A Repo edited on this canvas so it differs from its Repository: the
 *  attention-fill dot, explained on hover. */
function CustomizedDot() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label="Customized for this canvas"
            className="flex size-4 shrink-0 items-center justify-center"
          >
            <NeedsYouDot />
          </span>
        </TooltipTrigger>
        <TooltipContent>Customized for this canvas</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
      {i > 0 && <span className="mx-1.5">·</span>}
      <code className="font-mono text-xs">{script}</code>
    </span>
  ))
}
