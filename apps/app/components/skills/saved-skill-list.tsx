"use client"

import { useEffect, useMemo, useState } from "react"
import {
  BookOpenIcon,
  DotsThreeIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
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
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { ChatMarkdown } from "@/components/agent/chat-markdown"
import { FileRow } from "@/components/canvas/canvas-files-section"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { SettingsRow, SettingsRowList } from "@/components/home/settings-row"
import { mediaTypeFor } from "@/lib/files/paths"
import { fileTree, type FileTreeNode } from "@/lib/files/tree"
import { parseFrontmatter } from "@/lib/skills/frontmatter"
import type { OpenedSkill, SavedSkill } from "@/lib/skills/saved"
import type { FileEntryData } from "@/lib/types"
import { formatDistanceToNow } from "@/lib/utils"

/** What differs between the account and canvas lists: their words. */
export interface SavedSkillCopy {
  emptyDescription: string
  /** The Delete confirm's line on what deleting does. */
  deleteDescription: string
}

const SKILL_FILE = "SKILL.md"

/**
 * A saved-Skills list (#1557, spec #1554): one row per Skill with its
 * description and who saved it, Open (the Skill read-only, in a dialog) and a
 * menu holding Delete, like the Memory rows. There is no Add or Edit: people
 * ask a chat to save or change a Skill. Canvas settings › Skills and
 * Settings › Skills (#1558) render it.
 */
export function SavedSkillList({
  skills,
  copy,
  memberName,
  readSkill,
  deleteSkill,
}: {
  /** The Skills, by name. */
  skills: SavedSkill[]
  copy: SavedSkillCopy
  /** A member's name, for "Added by …"; unknown members read "a member". */
  memberName?: (userId: string) => string | undefined
  readSkill: (name: string) => Promise<OpenedSkill>
  deleteSkill: (name: string) => Promise<void>
}) {
  const [opened, setOpened] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const source = (skill: SavedSkill) => {
    const who =
      skill.addedBy === "agent"
        ? "Saved by agent"
        : `Added by ${memberName?.(skill.addedById) ?? "a member"}`
    return `${who} · ${formatDistanceToNow(skill.updatedAt)}`
  }

  return (
    <>
      {skills.length === 0 ? (
        <Empty className="flex-none border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenIcon />
            </EmptyMedia>
            <EmptyTitle>No skills yet</EmptyTitle>
            <EmptyDescription>{copy.emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SettingsRowList>
          {skills.map((skill) => (
            <SettingsRow
              key={skill.name}
              title={skill.name}
              detail={
                <>
                  <span className="block truncate">{skill.description}</span>
                  <span className="block truncate">{source(skill)}</span>
                </>
              }
              action={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Open skill: ${skill.name}`}
                    onClick={() => setOpened(skill.name)}
                  >
                    Open
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`More actions for skill: ${skill.name}`}
                      >
                        <DotsThreeIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(skill.name)}
                      >
                        <TrashIcon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          ))}
        </SettingsRowList>
      )}
      <SkillDialog
        key={opened ?? "closed"}
        skill={skills.find((s) => s.name === opened) ?? null}
        readSkill={readSkill}
        onOpenChange={(open) => {
          if (!open) setOpened(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        verb="Delete"
        itemName={deleting ?? undefined}
        itemNoun="skill"
        description={copy.deleteDescription}
        onConfirm={async () => {
          if (!deleting) return
          await deleteSkill(deleting)
          setDeleting(null)
        }}
      />
    </>
  )
}

type Loaded =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; skill: OpenedSkill }

/**
 * One Skill, read-only: its name and description, then `SKILL.md`'s body
 * rendered. A Skill with supporting files gets a sidebar holding its folder
 * as a tree, the Files section's own; Markdown renders, anything else shows
 * as text.
 */
function SkillDialog({
  skill,
  readSkill,
  onOpenChange,
}: {
  skill: SavedSkill | null
  readSkill: (name: string) => Promise<OpenedSkill>
  onOpenChange: (open: boolean) => void
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [path, setPath] = useState(SKILL_FILE)
  const name = skill?.name

  useEffect(() => {
    if (!name) return
    let cancelled = false
    readSkill(name).then(
      (value) => {
        if (!cancelled) setLoaded({ state: "ready", skill: value })
      },
      (err) => {
        console.error("Failed to open skill", err)
        if (!cancelled) setLoaded({ state: "failed" })
      }
    )
    return () => {
      cancelled = true
    }
  }, [name, readSkill, attempt])

  const files = useMemo(
    () => (loaded.state === "ready" ? loaded.skill.files : []),
    [loaded]
  )
  const withSidebar = files.length > 0
  const tree = useMemo(
    () =>
      fileTree(
        [SKILL_FILE, ...files.map((f) => f.path)].map((p) => treeEntry(p))
      ),
    [files]
  )
  // Folders start open: a Skill's folder is small, and its files are the
  // point of the sidebar.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const branch = (nodes: FileTreeNode[]): React.ReactNode =>
    nodes.map((node) => (
      <FileRow
        key={node.entry.path}
        node={node}
        open={!closed.has(node.entry.path)}
        active={node.entry.path === path}
        onToggle={() =>
          setClosed((prev) => {
            const next = new Set(prev)
            if (!next.delete(node.entry.path)) next.add(node.entry.path)
            return next
          })
        }
        onOpen={() => setPath(node.entry.path)}
      >
        {node.children.length > 0 && branch(node.children)}
      </FileRow>
    ))
  const content =
    loaded.state !== "ready"
      ? null
      : path === SKILL_FILE
        ? skillBody(loaded.skill.content)
        : (files.find((f) => f.path === path)?.content ?? "")

  const body = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={cn(
          "flex flex-col gap-2 px-6 pr-12 pb-4",
          // Beside the sidebar, the title centres on its first file row.
          withSidebar ? "pt-3" : "pt-6"
        )}
      >
        <DialogTitle className="break-words">{skill?.name}</DialogTitle>
        <DialogDescription>{skill?.description}</DialogDescription>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {loaded.state === "loading" ? (
          <div
            role="status"
            aria-label="Opening skill…"
            className="flex justify-center py-8"
          >
            <Spinner className="size-4" />
          </div>
        ) : loaded.state === "failed" ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Couldn’t open this skill. Try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoaded({ state: "loading" })
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          </div>
        ) : path.endsWith(".md") ? (
          <ChatMarkdown className="[&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm">
            {content ?? ""}
          </ChatMarkdown>
        ) : (
          <pre className="font-mono text-xs break-words whitespace-pre-wrap">
            {content}
          </pre>
        )}
      </div>
    </div>
  )

  return (
    <Dialog open={skill !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          withSidebar
            ? "h-[min(560px,80vh)] gap-0 overflow-hidden p-0 md:max-w-[700px]"
            : "max-h-[80vh] gap-0 overflow-hidden p-0 sm:max-w-xl"
        }
      >
        {withSidebar ? (
          <SidebarProvider className="min-h-0 min-w-0 items-stretch">
            <Sidebar collapsible="none" className="hidden w-56 md:flex">
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu aria-label="Files">{branch(tree)}</SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
            {body}
          </SidebarProvider>
        ) : (
          <div className="flex max-h-[80vh] min-h-0 flex-col">{body}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** A Skill's file as a tree entry; folders come from the paths. */
function treeEntry(path: string): FileEntryData {
  return {
    id: path,
    path,
    kind: "file",
    size: 0,
    mediaType: mediaTypeFor(path, "text/plain"),
    addedBy: "agent",
    addedById: "",
    blobKey: "",
    createdAt: 0,
    updatedAt: 0,
  }
}

/** `SKILL.md` without its frontmatter, which the dialog's header already shows. */
function skillBody(content: string): string {
  try {
    return parseFrontmatter(content, "").body
  } catch {
    return content
  }
}
