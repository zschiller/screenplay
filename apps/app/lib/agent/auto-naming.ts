import type { RoomDoc } from "@/lib/room-access"
import type { RepoData } from "@/lib/types"

/**
 * Auto-naming on the server (#910). A new chat's first turn names the Chat
 * Session and, while the Branch is still auto-named, the Branch itself. The
 * server writes both to the room Y.Doc and renames the git branch; browsers
 * only observe the doc. Nothing here depends on which surfaces are open or how
 * many clients are connected, so each name is applied exactly once.
 */

/** The turn's Room: read-modify-write access to its doc (Room Access). */
export type NamingRoom = Pick<RoomDoc, "mutateDoc">

/** A Branch rename the doc has already taken; the git rename is still owed. */
export interface BranchRenameClaim {
  branchId: string
  sandboxName: string
  userId: string
  repo: RepoData
  from: string
  to: string
  /** The Branch's flag before the claim, restored if git refuses. */
  previousAutoNamed: boolean | undefined
}

/**
 * Write a new chat's label and the Workspace's title, and claim the Branch
 * rename. The claim is one
 * transaction that checks the Branch is still auto-named and flips the flag,
 * so two turns racing on the same Branch can't both rename it.
 *
 * Returns the claim when the Branch was renamed in the doc (the git rename
 * follows in {@link renameClaimedBranch}), otherwise `null`.
 */
export async function applyNames(
  room: NamingRoom,
  input: {
    chatId: string
    sandboxName: string
    userId: string
    label?: string
    branch?: string
    /** The Workspace title (#881); never replaces one already set. */
    title?: string
  }
): Promise<BranchRenameClaim | null> {
  const { chatId, sandboxName, userId, label, title } = input
  const to = input.branch
  return room.mutateDoc(({ branches, chatSessions, repos, transact }) => {
    let claim: BranchRenameClaim | null = null
    transact(() => {
      if (label) chatSessions.update(chatId, { label })
      // Find the Branch by its (fixed) sandbox, then read it fresh: `toArray`
      // is a cached snapshot that only refreshes while something observes the
      // collection, and the flag check is what makes the claim exactly-once.
      const id = branches
        .toArray()
        .find((b) => b.sandboxName === sandboxName)?.id
      const branch = id ? branches.get(id) : undefined
      if (branch && title && !branch.title?.trim()) {
        branches.update(branch.id, { title })
      }
      if (!to) return
      if (!branch || branch.autoNamedBranch === false) return
      if (!branch.ref || branch.ref === to) return
      const repo = repos.get(branch.repoId)
      if (!repo) return
      branches.update(branch.id, { ref: to, autoNamedBranch: false })
      claim = {
        branchId: branch.id,
        sandboxName,
        userId,
        repo,
        from: branch.ref,
        to,
        previousAutoNamed: branch.autoNamedBranch,
      }
    })
    // Assigned inside `transact`, which TS's narrowing can't see.
    return claim as BranchRenameClaim | null
  })
}

/**
 * Rename the claimed branch in the Sandbox (and on GitHub). When git refuses,
 * put the Branch back as it was, unless someone renamed it again meanwhile.
 */
export async function renameClaimedBranch(
  deps: {
    room: NamingRoom
    renameGitBranch: (claim: BranchRenameClaim) => Promise<boolean>
  },
  claim: BranchRenameClaim
): Promise<void> {
  const ok = await deps.renameGitBranch(claim).catch(() => false)
  if (ok) return
  await deps.room.mutateDoc(({ branches }) => {
    if (branches.get(claim.branchId)?.ref !== claim.to) return
    branches.update(claim.branchId, {
      ref: claim.from,
      autoNamedBranch: claim.previousAutoNamed,
    })
  })
}
