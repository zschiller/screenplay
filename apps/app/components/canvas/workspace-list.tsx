"use client"

import {
  Check,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Undo2,
} from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { BranchBadge } from "@/components/branch-badge"
import { prStateColor } from "@/components/pr-state-color"
import type { BranchData } from "@/lib/types"
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

/** A row's leading glyph, as in the sidebar: busy, its PR, or a bare branch. */
function WorkspaceIcon({ branch }: { branch: BranchData }) {
  // Wrapped so the item's selected state doesn't repaint a PR's colour.
  let icon
  if (branch.status === "creating" || branch.status === "starting") {
    icon = (
      <Spinner
        aria-label="Starting"
        className="size-3.5 text-muted-foreground"
      />
    )
  } else if (branch.prState) {
    const Icon =
      branch.prState === "merged"
        ? GitMerge
        : branch.prState === "closed"
          ? GitPullRequestClosed
          : GitPullRequest
    icon = <Icon className={cn("size-3.5", prStateColor(branch.prState))} />
  } else {
    icon = <GitBranch className="size-3.5 text-muted-foreground" />
  }
  return <span className="flex shrink-0">{icon}</span>
}

/** An exception frame's way back to its Group's Workspace (#868). */
export interface FollowGroup {
  /** The Group's name. */
  name: string
  workspace: FrameWorkspace
}

/**
 * The searchable Workspace list a frame's Workspace switchers open (the label
 * picker and the address bar's host, issue #867): status icon, pill, diff and
 * a check on the current one. For a frame on another Workspace than its Group
 * (#868), it leads with "Follow <Group>", which picks the Group's.
 */
export function WorkspaceCommandList({
  branches,
  currentBranchId,
  onPick,
  followGroup,
}: {
  branches: BranchData[]
  currentBranchId?: string
  onPick: (branchId: string) => void
  followGroup?: FollowGroup
}) {
  return (
    <Command>
      <CommandInput placeholder="Search workspaces…" />
      <CommandList>
        <CommandEmpty>No workspaces found.</CommandEmpty>
        {followGroup && (
          <>
            <CommandGroup heading="Group">
              <CommandItem
                value={`Follow ${followGroup.name}`}
                onSelect={() => onPick(followGroup.workspace.branchId)}
              >
                <Undo2 />
                <span className="truncate">Follow {followGroup.name}</span>
                <BranchBadge
                  branch={followGroup.workspace.ref}
                  title={followGroup.workspace.title}
                  colorKey={followGroup.workspace.branchId}
                  colorIndex={followGroup.workspace.colorIndex}
                  className="ml-auto min-w-0 px-1.5 py-0 text-2xs"
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
                <WorkspaceIcon branch={a} />
                <BranchBadge
                  branch={a.ref}
                  title={a.title}
                  colorKey={a.id}
                  colorIndex={a.colorIndex}
                  className="min-w-0 px-1.5 py-0 text-2xs"
                />
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {hasDiff && (
                    <span className="flex items-center gap-1 font-mono text-3xs">
                      <span className="text-success">+{a.diffAdditions}</span>
                      <span className="text-destructive">
                        -{a.diffDeletions}
                      </span>
                    </span>
                  )}
                  <Check
                    className={cn(
                      "size-3.5",
                      a.id !== currentBranchId && "invisible"
                    )}
                  />
                </span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
