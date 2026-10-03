"use client"

import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { WarningIcon } from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import {
  WorkspaceMention,
  workspacePr,
  type WorkspaceMentionBranch,
} from "@/components/workspace-mention"
import { ConfirmDialog, ConfirmOption } from "@/components/confirm-dialog"
import { LostWorkAlert } from "@/components/delete-facts"
import type { WorkspaceState } from "@/lib/branch/workspace-state"
import {
  lostWork,
  projectLostWorkWarning,
  workspaceStateChip,
  type UnsavedWork,
} from "@/lib/branch/unsaved-work"

/** One of the Project's Workspaces, as the confirm lists it. */
export type DeleteRepoWorkspace = WorkspaceMentionBranch & {
  id: string
  /** Its state, for its state icon. */
  state: WorkspaceState
  /** Its PR, when open: the row says so, and it closes with the branch. */
  openPrNumber?: number
  /** The checkout's git state: `undefined` while read, `null` when unreadable. */
  work: UnsavedWork | null | undefined
}

type DeleteRepoDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoName: string
  workspaces: DeleteRepoWorkspace[]
  /**
   * Whether deleting the branches on GitHub could work: a token resolves and
   * the Project names a GitHub remote. False hides the option (issue #741).
   */
  canDeleteOnRemote: boolean
  /** The local build keeps each git branch in the clone on this computer. */
  localBranchKept: boolean
  onConfirm: (options: { deleteBranchesOnRemote: boolean }) => Promise<void>
}

/**
 * Confirm removing a Project (a Repo) and all of its Workspaces from the
 * canvas: each Workspace as a row with its state, a warning only when work
 * would be lost, and an opt-in, off by default, to delete the git branches on
 * GitHub too (issue #776).
 */
export function DeleteRepoDialog({
  open,
  onOpenChange,
  repoName,
  workspaces,
  canDeleteOnRemote,
  localBranchKept,
  onConfirm,
}: DeleteRepoDialogProps) {
  const [deleteBranchesOnRemote, setDeleteBranchesOnRemote] = useState(false)

  // Reset the option when the dialog closes, so reopening starts local-only.
  // The previous-prop pattern rather than an effect (see react.dev "You Might
  // Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setDeleteBranchesOnRemote(false)
  }

  const count = workspaces.length
  const offerRemote = canDeleteOnRemote && count > 0
  // Never act on a remote delete the dialog didn't offer.
  const remote = offerRemote && deleteBranchesOnRemote
  const openPrs = workspaces.filter((w) => w.openPrNumber)
  const warning = projectLostWorkWarning(
    workspaces.flatMap((w) =>
      w.work ? [lostWork(w.work, { localBranchKept })] : []
    )
  )

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb="Remove"
      itemName={repoName}
      itemNoun="repository"
      description={
        count === 0
          ? "The repository is removed from this canvas."
          : count === 1
            ? "Its workspace is removed from this canvas, with its chats and frames."
            : `Its ${count} workspaces are removed from this canvas, with their chats and frames.`
      }
      onConfirm={() => onConfirm({ deleteBranchesOnRemote: remote })}
    >
      {({ pending }) =>
        count > 0 && (
          <div className="grid gap-4">
            <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border">
              {workspaces.map((w) => (
                <li
                  key={w.id}
                  className="flex min-w-0 items-center gap-2 px-3 py-2"
                >
                  <WorkspaceMention branch={w} state={w.state} pr="after" />
                  <StateChip workspace={w} localBranchKept={localBranchKept} />
                </li>
              ))}
            </ul>
            {warning && <LostWorkAlert>{warning}</LostWorkAlert>}
            {offerRemote && (
              <ConfirmOption
                id="delete-branches-on-remote"
                label={
                  count === 1
                    ? "Also delete its branch on GitHub"
                    : `Also delete these ${count} branches on GitHub`
                }
                hint={
                  openPrs.length === 1
                    ? `Closes PR #${openPrs[0]!.openPrNumber}`
                    : openPrs.length > 1
                      ? `Closes ${openPrs.length} open PRs`
                      : undefined
                }
                checked={deleteBranchesOnRemote}
                onCheckedChange={setDeleteBranchesOnRemote}
                disabled={pending}
              />
            )}
          </div>
        )
      }
    </ConfirmDialog>
  )
}

function StateChip({
  workspace,
  localBranchKept,
}: {
  workspace: DeleteRepoWorkspace
  localBranchKept: boolean
}) {
  const chip = workspaceStateChip(
    workspace.work,
    { number: workspace.openPrNumber, open: !!workspace.openPrNumber },
    { localBranchKept }
  )
  if (!chip) return null
  // The row's PR badge already says it.
  if (chip.kind === "pr" && workspacePr(workspace)) return null
  if (chip.kind === "loading") {
    return (
      <Spinner
        className="ml-auto size-3.5 shrink-0 text-muted-foreground"
        aria-label="Checking for unpushed work"
      />
    )
  }
  return (
    <Badge
      variant={chip.kind === "lost" ? "outline" : "secondary"}
      className={cn(
        "ml-auto shrink-0 gap-1 font-normal",
        chip.kind === "lost" ? "text-warning" : "text-muted-foreground"
      )}
    >
      {chip.kind === "lost" && (
        <WarningIcon aria-hidden className="size-3 text-warning" />
      )}
      {chip.label}
    </Badge>
  )
}
