"use client"

import type { ReactNode } from "react"
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  WarningIcon,
} from "@workspace/ui/components/icons"
import { Badge } from "@workspace/ui/components/badge"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { GripSpinner } from "@/components/grip-spinner"
import { prStateColor } from "@/components/pr-state-color"
import { isBranchBusy } from "@/lib/branch-busy"
import {
  workspaceStatusLine,
  type WorkspaceStatusLine,
} from "@/lib/branch/status-line"
import type { BranchPrInfo } from "@/lib/github-actions"
import type { BranchData } from "@/lib/types"
import { hasWorkspaceTitle, workspaceLabel } from "@/lib/workspace-label"
import { useChatSessions } from "@/lib/yjs/react"

/**
 * One way to draw a Workspace (#974): its state icon, its plain name, and its
 * PR as an outline badge. No Workspace colour. Every list and header that names
 * a Workspace uses it: the sidebar rows, the frame's Workspace switcher, the
 * chat header and its picker, and the Remove repository dialog.
 */

/** The slice of a Branch a mention reads. {@link BranchData} satisfies it. */
export type WorkspaceMentionBranch = Pick<
  BranchData,
  | "ref"
  | "title"
  | "status"
  | "statusMessage"
  | "error"
  | "doneAt"
  | "prNumber"
  | "prState"
>

/**
 * The Workspace's state as one glyph (#963): the regular spinner while setting
 * up, the 9-dot while its agent works, a small dot when ready, a dashed circle
 * when stopped, a muted check circle when Done (#976), the warning triangle
 * when setup failed. Never PR state. It
 * takes its colour from the text around it, so it reads the same in the
 * sidebar and in a popover.
 */
export function WorkspaceStateGlyph({ line }: { line: WorkspaceStatusLine }) {
  const glyph =
    line.kind === "error" ? (
      <WarningIcon className="size-3.5 text-destructive" />
    ) : line.kind === "progress" ? (
      <Spinner className="size-3.5 opacity-70" />
    ) : line.state === "working" ? (
      <GripSpinner className="size-3.5 opacity-70" />
    ) : line.state === "done" ? (
      <CheckCircleIcon weight="bold" className="size-3! opacity-50" />
    ) : line.state === "stopped" ? (
      // Sized past a menu button's own svg size, like the idle circle, so the
      // outlines match; Bold keeps the dashes legible at 12px.
      <CircleDashedIcon weight="bold" className="size-3! opacity-50" />
    ) : (
      <CircleIcon weight="bold" className="size-3! opacity-50" />
    )
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {glyph}
    </span>
  )
}

/** The state glyph for a Workspace, labelled with its state in words. */
export function WorkspaceStateIcon({
  branch,
  agentWorking,
}: {
  branch: Pick<BranchData, "status" | "statusMessage" | "error" | "doneAt">
  agentWorking: boolean
}) {
  const line = workspaceStatusLine(branch, { agentWorking })
  return (
    <span
      role="img"
      aria-label={
        line.kind === "progress"
          ? line.step
          : line.kind === "error"
            ? line.title
            : line.text
      }
      className="flex shrink-0"
    >
      <WorkspaceStateGlyph line={line} />
    </span>
  )
}

export type WorkspacePr = { number: number; state: BranchPrInfo["state"] }

/**
 * A Workspace's PR: the stock outline Badge holding GitHub's state glyph in its
 * state colour and `#N`.
 */
export function WorkspacePrBadge({
  number,
  state,
  className,
}: {
  number: number
  state: BranchPrInfo["state"]
  className?: string
}) {
  const Icon = state === "merged" ? GitMergeIcon : GitPullRequestIcon
  return (
    <Badge
      variant="outline"
      data-slot="workspace-pr"
      className={cn(
        "h-4 shrink-0 gap-0.5 rounded-sm px-1 py-0 text-xs font-medium text-muted-foreground tabular-nums",
        className
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-3! shrink-0", prStateColor(state))}
      />
      <span className="sr-only">PR </span>#{number}
      <span className="sr-only">, {state}</span>
    </Badge>
  )
}

/**
 * The PR a mention shows: the Workspace's own (or `pr`, when the caller holds a
 * fresher one), only while it's up. One setting up, stopped or failed shows
 * none (#963).
 */
export function workspacePr(
  branch: WorkspaceMentionBranch,
  pr?: WorkspacePr | null
): WorkspacePr | null {
  if (branch.status !== "running" || branch.error) return null
  if (pr !== undefined) return pr
  if (!branch.prNumber || !branch.prState) return null
  return { number: branch.prNumber, state: branch.prState }
}

/** Whether each Workspace has a chat turn in flight, read from the room doc. */
export function useWorkspaceAgentWorking(): (branchId: string) => boolean {
  const chats = useChatSessions()
  return (branchId) => isBranchBusy(branchId, chats)
}

/**
 * A Workspace mention: state icon, plain name, PR badge.
 *
 * The name and the badge share one line that wraps into a clipped second line,
 * so the badge is the first thing to go when there isn't room: the name never
 * truncates to make space for it.
 *
 * - `pr`: `"end"` puts the badge at the far end (list rows), `"after"` right
 *   after the name, `false` leaves it out (the chat header, which keeps its
 *   own PR control).
 * - `fallback` takes the badge's slot when there's no PR (a list row's line
 *   count).
 * - `icon` and `name` replace the state icon and the name, for a row that makes
 *   them interactive (the sidebar's failure card and inline rename).
 */
export function WorkspaceMention({
  branch,
  agentWorking = false,
  pr = "end",
  prOverride,
  fallback,
  icon,
  name,
  endClassName,
  className,
}: {
  branch: WorkspaceMentionBranch
  agentWorking?: boolean
  pr?: "end" | "after" | false
  /** The PR to show when the caller holds a fresher one than the doc. */
  prOverride?: WorkspacePr | null
  fallback?: ReactNode
  icon?: ReactNode
  name?: ReactNode
  /** Classes for the badge or fallback slot (e.g. hiding it under a hover menu). */
  endClassName?: string
  className?: string
}) {
  const shownPr = pr === false ? null : workspacePr(branch, prOverride)
  const end = shownPr ? (
    <WorkspacePrBadge number={shownPr.number} state={shownPr.state} />
  ) : pr === false ? null : (
    fallback
  )
  return (
    <span
      data-slot="workspace-mention"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 has-[[data-editable-text=editing]]:overflow-visible",
        className
      )}
    >
      {icon ?? (
        <WorkspaceStateIcon branch={branch} agentWorking={agentWorking} />
      )}
      <span
        className={cn(
          // One line tall; a badge that doesn't fit wraps onto a second line
          // pushed past the clip.
          "flex h-5 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-5 overflow-hidden leading-5",
          // Renaming inline: let the field's ring show, and drop the badge.
          "has-[[data-editable-text=editing]]:overflow-visible has-[[data-editable-text=editing]]:[&>[data-slot=workspace-mention-end]]:hidden"
        )}
      >
        {name ?? (
          <span
            className={cn(
              "max-w-full min-w-0 truncate",
              !hasWorkspaceTitle(branch) && "font-mono text-xs"
            )}
          >
            {workspaceLabel(branch)}
          </span>
        )}
        {end && (
          <span
            data-slot="workspace-mention-end"
            className={cn(
              "flex shrink-0 items-center",
              pr === "end" && "ml-auto",
              endClassName
            )}
          >
            {end}
          </span>
        )}
      </span>
    </span>
  )
}
