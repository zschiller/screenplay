"use client"

import { useState } from "react"
import { ConfirmDialog, ConfirmOption } from "@/components/confirm-dialog"
import { LostWorkAlert, joinFacts } from "@/components/delete-facts"
import {
  lostWork,
  lostWorkWarning,
  type UnsavedWork,
} from "@/lib/branch/unsaved-work"

type DeleteBranchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  /**
   * Whether deleting the branch on the remote is something this Project could
   * actually do: a GitHub API token resolves *and* the Project has a GitHub
   * remote to name. False hides the option outright rather than disabling it —
   * an offer that can only fail is worse than no offer (issue #741).
   */
  canDeleteOnRemote: boolean
  /** The Chat Sessions and frames the delete cascades to (history included). */
  chatCount: number
  frameCount: number
  /** The Workspace's PR, when it has an open one: it stays, or closes with the branch. */
  openPrNumber?: number
  /**
   * The checkout's git state: `undefined` while it's being read, `null` when it
   * couldn't be (a stopped Sandbox). Only a read answer ever raises a warning.
   */
  work: UnsavedWork | null | undefined
  /**
   * Whether the git branch outlives the Workspace on this device (the local
   * build, where it lives on in the clone), so its commits aren't lost.
   */
  localBranchKept: boolean
  onConfirm: (options: { deleteOnRemote: boolean }) => Promise<void>
}

/**
 * Confirm deleting a Workspace (a Branch): what it removes, what it keeps, a
 * warning only when work would be lost, and an opt-in to take the git branch
 * off GitHub too (issue #776).
 *
 * The remote delete is strictly opt-in: it defaults **off** and is only offered
 * when it could succeed (`canDeleteOnRemote`). It used to default on, which on
 * the desktop build — where GitHub API access is optional by design (the no-auth
 * floor, ADR 0008) — meant the common path failed inline with "No GitHub token"
 * and deleted nothing until the user noticed the toggle.
 */
export function DeleteBranchDialog({
  open,
  onOpenChange,
  branchName,
  canDeleteOnRemote,
  chatCount,
  frameCount,
  openPrNumber,
  work,
  localBranchKept,
  onConfirm,
}: DeleteBranchDialogProps) {
  const [deleteOnRemote, setDeleteOnRemote] = useState(false)

  // Reset the opt-in when the dialog closes, so reopening starts local-only.
  // The previous-prop pattern rather than an effect (see react.dev "You Might
  // Not Need an Effect").
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setDeleteOnRemote(false)
  }

  // Never act on a remote delete the dialog didn't offer: the option's state
  // is unreachable while it's hidden.
  const remote = canDeleteOnRemote && deleteOnRemote
  // Whether the git branch is on origin: the checkout says, and an open PR
  // implies it while the checkout is unread.
  const onOrigin = work?.onOrigin ?? !!openPrNumber
  // The branch name is already in the title, so the facts name places, not
  // refs: "the git branch on this computer and GitHub".
  const removes: string[] = []
  if (chatCount > 0) removes.push(count(chatCount, "chat", "chats"))
  if (frameCount > 0) removes.push(count(frameCount, "frame", "frames"))
  removes.push("its sandbox")
  if (remote) removes.push("the git branch on GitHub")

  const branchKeptOn = [
    localBranchKept && "this computer",
    !remote && onOrigin && "GitHub",
  ].filter(Boolean)
  const keeps: string[] = []
  if (branchKeptOn.length > 0) {
    keeps.push(`the git branch on ${branchKeptOn.join(" and ")}`)
  }
  if (!remote && openPrNumber) keeps.push(`PR #${openPrNumber}`)

  const warning = work
    ? lostWorkWarning(lostWork(work, { localBranchKept }))
    : null

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      verb="Delete"
      itemName={branchName}
      itemNoun="workspace"
      description={
        <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5">
          <dt>Removes</dt>
          <dd className="text-foreground">{joinFacts(removes)}</dd>
          {keeps.length > 0 && (
            <>
              <dt>Keeps</dt>
              <dd className="text-foreground">{joinFacts(keeps)}</dd>
            </>
          )}
        </dl>
      }
      onConfirm={() => onConfirm({ deleteOnRemote: remote })}
    >
      {({ pending }) =>
        (warning || canDeleteOnRemote) && (
          <div className="grid gap-4">
            {warning && <LostWorkAlert>{warning}</LostWorkAlert>}
            {canDeleteOnRemote && (
              <ConfirmOption
                id="delete-on-remote"
                label="Also delete the branch on GitHub"
                hint={openPrNumber ? `Closes PR #${openPrNumber}` : undefined}
                checked={deleteOnRemote}
                onCheckedChange={setDeleteOnRemote}
                disabled={pending}
              />
            )}
          </div>
        )
      }
    </ConfirmDialog>
  )
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
