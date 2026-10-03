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
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { GripSpinner } from "@/components/grip-spinner"
import { prStateColor } from "@/components/pr-state-color"
import type { WorkspaceStatusLine } from "@/lib/branch/workspace-state"
import type { WorkspaceState } from "@/lib/branch/workspace-state"
import type { BranchPrInfo } from "@/lib/github-actions"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

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
  | "prBlocked"
>

/**
 * The Workspace's state as one glyph (#963): the regular spinner while setting
 * up, the 9-dot while its agent works, a filled orange dot when it needs you
 * (a plan to approve or a blocked PR, as the Coordinator's task rows and the
 * Workspaces button draw it; #1283), a small circle when ready, a dashed circle
 * when stopped, a muted check circle when Done (#976), the warning triangle
 * when setup failed. Never the PR's own state. It
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
    ) : line.state === "needs-you" ? (
      <NeedsYouDot />
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

/**
 * A Workspace needs you: a filled orange dot, calmer than a warning (#1283).
 * The state glyph, the Coordinator's task rows and the Workspaces button's
 * dot all draw it.
 */
export function NeedsYouDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="needs-you-dot"
      className={cn(
        "size-2 shrink-0 rounded-full bg-attention-fill",
        className
      )}
    />
  )
}

/** The state glyph for a Workspace, labelled with its state in words. */
export function WorkspaceStateIcon({ state }: { state: WorkspaceState }) {
  const { line } = state
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
 * A Workspace's PR: GitHub's state glyph and `#N` in its state colour, set as
 * plain text with no border or padding. Only the chat header's PR button has a
 * border, because that's a button.
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
    <span
      data-slot="workspace-pr"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums",
        prStateColor(state),
        className
      )}
    >
      <Icon aria-hidden className="size-3! shrink-0" />
      <span className="sr-only">PR </span>#{number}
      <span className="sr-only">, {state}</span>
    </span>
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
 * - `state` is its {@link WorkspaceState}, from `useWorkspaceStates`, for the
 *   state icon and the name. There's no default: a mention always shows the
 *   Workspace's real state.
 * - `icon` and `name` replace the state icon and the name, for a row that makes
 *   them interactive (the sidebar's failure card and inline rename). A row
 *   with its own icon may leave `state` out.
 */
export function WorkspaceMention({
  branch,
  state,
  pr = "end",
  prOverride,
  fallback,
  icon,
  name,
  endClassName,
  className,
}: {
  branch: WorkspaceMentionBranch
  pr?: "end" | "after" | false
  /** The PR to show when the caller holds a fresher one than the doc. */
  prOverride?: WorkspacePr | null
  fallback?: ReactNode
  name?: ReactNode
  /** Classes for the badge or fallback slot (e.g. hiding it under a hover menu). */
  endClassName?: string
  className?: string
} & (
  | { state: WorkspaceState; icon?: undefined }
  | { state?: WorkspaceState; icon: ReactNode }
)) {
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
      {icon ?? (state && <WorkspaceStateIcon state={state} />)}
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
          <span className="max-w-full min-w-0 truncate">
            {state?.label ?? workspaceLabel(branch)}
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
