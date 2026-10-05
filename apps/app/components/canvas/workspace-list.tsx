"use client"

import { useState } from "react"
import {
  ChatCircleIcon,
  CheckIcon,
  PlusIcon,
} from "@workspace/ui/components/icons"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { cn } from "@workspace/ui/lib/utils"
import { WorkspaceMention } from "@/components/workspace-mention"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import type { FrameWorkspace } from "./frame-nav"

/**
 * Workspaces a frame can be switched to: ones with a ref that haven't failed,
 * stopped or been marked done. Busy ones (creating, starting) stay pickable
 * with a spinner. A Done Workspace hides its frames (#976), so it stays out
 * even when a start that finished after Mark as done left it running.
 */
export function pickableWorkspaces(
  branches: readonly BranchData[]
): BranchData[] {
  return branches.filter(
    (a) => a.ref && !a.doneAt && a.status !== "error" && a.status !== "stopped"
  )
}

/**
 * A Workspace's plain name, as the sidebar row draws it: its title, or "New
 * Workspace" when untitled. Lists and labels carry no Workspace colour.
 */
export function WorkspaceName({
  workspace,
  className,
}: {
  workspace: Pick<BranchData, "title" | "ref">
  className?: string
}) {
  return (
    <span className={cn("min-w-0 truncate", className)}>
      {workspaceLabel(workspace)}
    </span>
  )
}

/**
 * A Workspace named beside something else's name (#975): canvas labels and
 * the Canvas list's rows. The shared mention, muted by
 * its container.
 *
 * - `"label"`: sized to its content, the PR badge right after the Workspace's
 *   name while there's room.
 * - `"row"`: fills the room a list row's name leaves, with the PR badge at the
 *   row's end, like the Workspaces list.
 */
export function CompactWorkspaceMention({
  workspace,
  layout = "label",
}: {
  workspace: FrameWorkspace
  layout?: "label" | "row"
}) {
  const stateOf = useWorkspaceStates()
  return (
    <WorkspaceMention
      branch={workspace}
      state={stateOf({ ...workspace, id: workspace.branchId })}
      pr={layout === "row" ? "end" : "after"}
      className={cn("gap-1", layout === "label" && "flex-initial")}
    />
  )
}

/**
 * The searchable Workspace list a frame's Workspace switchers open (the label
 * pickers, issue #867): each row the shared Workspace
 * mention (#974: state icon, plain name, PR badge or line count) and a check on
 * the current one. The Group switcher (#869) opens it too. A drawn frame's
 * ask card (#1357) opens it with New chat as its first row.
 */
export function WorkspaceCommandList({
  branches,
  currentBranchId,
  onPick,
  placeholder = "Search chats…",
  newChat,
  sketch,
}: {
  branches: BranchData[]
  currentBranchId?: string
  onPick: (branchId: string) => void
  /** The search field's prompt; the Group switcher asks "Show <Group> from…". */
  placeholder?: string
  /** A New chat row above the Workspaces, checked when it's the pick. */
  newChat?: { current: boolean; onPick: () => void }
  /**
   * Chats with no repository, between New chat and the Workspaces: a New
   * chat, no repository row (checked when `current` is "new"), then each one.
   */
  sketch?: {
    chats: readonly { id: string; label: string }[]
    current: "new" | string | null
    onPick: (chatId?: string) => void
  }
}) {
  const stateOf = useWorkspaceStates()
  const workspaces = pickableWorkspaces(branches)
  // The check column is there only when a row can carry the check: an
  // unassigned frame's "Choose a chat" has none, so its rows run to the
  // edge instead of leaving an empty column. Settled when the list opens, so
  // a pick doesn't add the column while the list closes.
  const [checkable] = useState(
    () =>
      newChat !== undefined ||
      sketch !== undefined ||
      workspaces.some((a) => a.id === currentBranchId)
  )
  const check = (checked: boolean) =>
    checkable && (
      <CheckIcon className={cn("size-3.5", !checked && "invisible")} />
    )
  return (
    <Command>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>No chats found.</CommandEmpty>
        <CommandGroup>
          {newChat && (
            <CommandItem value="New chat" onSelect={newChat.onPick}>
              <PlusIcon className="text-muted-foreground" />
              <span className="flex-1">New chat</span>
              {check(newChat.current)}
            </CommandItem>
          )}
          {sketch && (
            <CommandItem
              value="New chat, no repository"
              onSelect={() => sketch.onPick()}
            >
              <PlusIcon className="text-muted-foreground" />
              <span className="flex-1">New chat, no repository</span>
              {check(sketch.current === "new")}
            </CommandItem>
          )}
          {sketch?.chats.map((chat) => (
            <CommandItem
              key={chat.id}
              value={`${chat.label} ${chat.id}`}
              onSelect={() => sketch.onPick(chat.id)}
            >
              <ChatCircleIcon className="text-muted-foreground" />
              <span className="flex-1 truncate">{chat.label}</span>
              {check(sketch.current === chat.id)}
            </CommandItem>
          ))}
          {workspaces.map((a) => {
            const hasDiff =
              a.status === "running" &&
              ((a.diffAdditions ?? 0) > 0 || (a.diffDeletions ?? 0) > 0)
            return (
              <CommandItem
                key={a.id}
                value={a.ref}
                keywords={a.title ? [a.title] : undefined}
                onSelect={() => onPick(a.id)}
              >
                <WorkspaceMention
                  branch={a}
                  state={stateOf(a)}
                  fallback={
                    hasDiff ? (
                      <span className="flex items-center gap-1 font-mono text-xs">
                        <span className="text-success">+{a.diffAdditions}</span>
                        <span className="text-destructive">
                          -{a.diffDeletions}
                        </span>
                      </span>
                    ) : null
                  }
                />
                {check(a.id === currentBranchId)}
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
