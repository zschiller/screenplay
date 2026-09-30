"use client"

import { ArrowUUpLeftIcon, CheckIcon } from "@workspace/ui/components/icons"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import { cn } from "@workspace/ui/lib/utils"
import { WorkspaceMention } from "@/components/workspace-mention"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import type { FrameWorkspace } from "./frame-nav"

/**
 * Workspaces a frame can be switched to: ones with a ref that haven't failed
 * or stopped. Busy ones (creating, starting) stay pickable with a spinner.
 */
export function pickableWorkspaces(branches: BranchData[]): BranchData[] {
  return branches.filter(
    (a) => a.ref && a.status !== "error" && a.status !== "stopped"
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
 * A Workspace named beside something else's name (#975): canvas labels, the
 * address bar's host and the Canvas list's rows. The shared mention, muted by
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

/** An exception frame's way back to its Group's Workspace (#868). */
export interface FollowGroup {
  /** The Group's name. */
  name: string
  workspace: FrameWorkspace
}

/**
 * The searchable Workspace list a frame's Workspace switchers open (the label
 * picker and the address bar's host, issue #867): each row the shared Workspace
 * mention (#974: state icon, plain name, PR badge or line count) and a check on
 * the current one. For a frame on another Workspace than its Group (#868), it
 * leads with "Follow <Group>", which picks the Group's. The Group switcher
 * (#869) opens it too, with a footer saying what the pick moves.
 */
export function WorkspaceCommandList({
  branches,
  currentBranchId,
  onPick,
  followGroup,
  placeholder = "Search workspaces…",
  footer,
}: {
  branches: BranchData[]
  currentBranchId?: string
  onPick: (branchId: string) => void
  followGroup?: FollowGroup
  /** The search field's prompt; the Group switcher asks "Show <Group> from…". */
  placeholder?: string
  /** Muted lines under the list, read before picking (#869). */
  footer?: string[]
}) {
  const stateOf = useWorkspaceStates()
  return (
    <Command>
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>No workspaces found.</CommandEmpty>
        {followGroup && (
          <>
            <CommandGroup heading="Group">
              <CommandItem
                value={`Follow ${followGroup.name}`}
                onSelect={() => onPick(followGroup.workspace.branchId)}
              >
                <ArrowUUpLeftIcon />
                <span className="truncate">Follow {followGroup.name}</span>
                <WorkspaceName
                  workspace={followGroup.workspace}
                  className="ml-auto text-muted-foreground"
                />
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading={followGroup ? "This frame only" : undefined}>
          {pickableWorkspaces(branches).map((a) => {
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
                <CheckIcon
                  className={cn(
                    "size-3.5",
                    a.id !== currentBranchId && "invisible"
                  )}
                />
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
      {footer && footer.length > 0 && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          {footer.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </Command>
  )
}
