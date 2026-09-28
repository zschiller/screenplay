"use client"

import { Check, CircleSmall, Undo2 } from "lucide-react"
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
import { PrStateBadge } from "@/components/pr-state-badge"
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

/**
 * A row's leading glyph, as in the sidebar (#963): its state only, busy or
 * ready. Its PR sits at the row's end. Stopped and failed Workspaces aren't
 * listed, and the switcher doesn't track agent turns.
 */
function WorkspaceIcon({ branch }: { branch: BranchData }) {
  const busy = branch.status === "creating" || branch.status === "starting"
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {busy ? (
        <Spinner
          aria-label="Starting"
          className="size-3.5 text-muted-foreground"
        />
      ) : (
        <CircleSmall className="size-3.5 text-muted-foreground/70" />
      )}
    </span>
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
 * picker and the address bar's host, issue #867): status icon, pill, PR or diff and
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
                  {a.status === "running" && a.prNumber && a.prState ? (
                    // Wrapped in the badge's own colour, so the item's
                    // selected state doesn't repaint it.
                    <PrStateBadge number={a.prNumber} state={a.prState} />
                  ) : hasDiff ? (
                    <span className="flex items-center gap-1 font-mono text-3xs">
                      <span className="text-success">+{a.diffAdditions}</span>
                      <span className="text-destructive">
                        -{a.diffDeletions}
                      </span>
                    </span>
                  ) : null}
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
