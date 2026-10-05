import type { RoomDoc } from "@/lib/room-access"

/**
 * The next PR after a merge (#1701). A Branch keeps one ref and ships PRs one
 * after another. Once its current PR has merged, the next turn on the Branch
 * (whoever or whatever sends it) first moves the ref onto the tip of the
 * repo's default branch, so the next PR carries only new work.
 *
 * The move is a direct action only while it can't lose anything: the working
 * tree is clean and every commit the Branch holds, here and on origin, is in
 * the merged PR. Otherwise it can conflict, so it's handed to the agent with a
 * note on the turn (ADR 0005: deterministic → direct action, can-conflict →
 * Engine). Either way the Branch records the PR in `prMovedPast`, which is what
 * brings Create PR back (`pr-readiness.ts`) and keeps this to once per PR.
 *
 * Three parts: {@link claimMergedPrMove} (the doc, at turn prepare),
 * {@link moveToDefaultTip} (git, through an injected runner so a test drives a
 * real temporary repo), and {@link mergedPrNote} (what the agent is told).
 */

/** The Branch's merged PR the turn moves past; claimed once in the doc. */
export interface MergedPrMoveClaim {
  branchId: string
  sandboxName: string
  /** The member the turn acts for: git fetches and pushes as them. */
  userId: string
  ref: string
  defaultBranch: string
  prNumber: number
}

/**
 * Claim the move for a turn on `sandboxName`'s Branch, in one transaction
 * that checks and records `prMovedPast`, so two turns racing on the Branch
 * can't both move it. Null when its current PR isn't merged or the Branch has
 * already moved past it.
 */
export async function claimMergedPrMove(
  room: Pick<RoomDoc, "mutateDoc">,
  input: { sandboxName: string; userId: string }
): Promise<MergedPrMoveClaim | null> {
  const { sandboxName, userId } = input
  return room.mutateDoc(({ branches, repos }) => {
    // `toArray` is a cached snapshot: find the id, then read it fresh.
    const id = branches.toArray().find((b) => b.sandboxName === sandboxName)?.id
    const branch = id ? branches.get(id) : undefined
    if (!branch?.ref || branch.prState !== "merged") return null
    const prNumber = branch.prNumber
    if (typeof prNumber !== "number" || branch.prMovedPast === prNumber)
      return null
    const repo = repos.get(branch.repoId)
    if (!repo?.defaultBranch || branch.ref === repo.defaultBranch) return null
    branches.update(branch.id, { prMovedPast: prNumber })
    return {
      branchId: branch.id,
      sandboxName,
      userId,
      ref: branch.ref,
      defaultBranch: repo.defaultBranch,
      prNumber,
    }
  })
}

/** One git command in the Workspace's checkout. `remote` marks one that
 *  talks to origin, which runs with the member's credentials. */
export type GitRun = (
  args: string[],
  opts?: { remote?: boolean }
) => Promise<{ ok: boolean; out: string }>

/** Why the move was handed to the agent. */
export type MoveHandover =
  /** Uncommitted changes in the working tree. */
  | "uncommitted"
  /** Commits on the Branch, or on origin's copy, that the PR doesn't hold. */
  | "extra-commits"
  /** Origin couldn't be read (the default branch or the PR's head). */
  | "unreachable"
  /** Moved here, but origin's copy couldn't be updated. */
  | "push-failed"

export type MoveOutcome =
  { kind: "moved" } | { kind: "handover"; reason: MoveHandover }

/**
 * Move the checkout onto the default branch's tip when nothing can be lost,
 * and update origin's copy of the Branch to match (with a lease on what it
 * held, so a push nobody here has seen is never overwritten).
 */
export async function moveToDefaultTip(
  git: GitRun,
  claim: Pick<MergedPrMoveClaim, "ref" | "defaultBranch" | "prNumber">
): Promise<MoveOutcome> {
  const { ref, defaultBranch, prNumber } = claim
  const handover = (reason: MoveHandover): MoveOutcome => ({
    kind: "handover",
    reason,
  })

  const status = await git(["status", "--porcelain"])
  if (!status.ok) return handover("unreachable")
  if (status.out) return handover("uncommitted")

  const fetched = await git(
    [
      "fetch",
      "--quiet",
      "origin",
      `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`,
      `+refs/pull/${prNumber}/head:refs/screenplay/merged-pr`,
    ],
    { remote: true }
  )
  if (!fetched.ok) return handover("unreachable")
  const prHead = "refs/screenplay/merged-pr"
  const contained = async (rev: string) =>
    (await git(["merge-base", "--is-ancestor", rev, prHead])).ok

  try {
    if (!(await contained("HEAD"))) return handover("extra-commits")

    // Origin's copy: gone (deleted after the merge) is fine; anything it holds
    // must be in the PR too.
    const remote = await git(["ls-remote", "origin", `refs/heads/${ref}`], {
      remote: true,
    })
    if (!remote.ok) return handover("unreachable")
    const remoteSha = remote.out.split(/\s/)[0] ?? ""
    if (remoteSha) {
      const known = (await git(["cat-file", "-e", `${remoteSha}^{commit}`])).ok
      if (!known) {
        const got = await git(["fetch", "--quiet", "origin", remoteSha], {
          remote: true,
        })
        if (!got.ok) return handover("unreachable")
      }
      if (!(await contained(remoteSha))) return handover("extra-commits")
    }

    const reset = await git([
      "reset",
      "--hard",
      `refs/remotes/origin/${defaultBranch}`,
    ])
    if (!reset.ok) return handover("unreachable")

    const pushed = await git(
      [
        "push",
        "--quiet",
        "--set-upstream",
        `--force-with-lease=refs/heads/${ref}:${remoteSha}`,
        "origin",
        `HEAD:refs/heads/${ref}`,
      ],
      { remote: true }
    )
    if (!pushed.ok) return handover("push-failed")
    return { kind: "moved" }
  } finally {
    await git(["update-ref", "-d", prHead])
  }
}

/**
 * What the agent is told at the start of the turn, ahead of the message: that
 * the Branch now starts from the latest code, or, when it was handed over,
 * how to get there.
 */
export function mergedPrNote(
  outcome: MoveOutcome,
  claim: Pick<MergedPrMoveClaim, "defaultBranch" | "prNumber">
): string {
  const { defaultBranch, prNumber } = claim
  const merged = `Pull request #${prNumber} from this branch has merged.`
  if (outcome.kind === "moved") {
    return `${merged} The branch now starts from the latest \`${defaultBranch}\`, so the next pull request carries only new changes. Work from here as usual.`
  }
  const why: Record<MoveHandover, string> = {
    uncommitted: "the working tree has uncommitted changes",
    "extra-commits": `the branch has commits that aren’t in #${prNumber}`,
    unreachable: "origin couldn’t be read",
    "push-failed": `it now starts from the latest \`${defaultBranch}\`, but pushing that to origin failed`,
  }
  const steps =
    outcome.reason === "push-failed"
      ? `Push it with \`git push --force-with-lease\` before anything else.`
      : `Before this message’s work, move it onto the latest \`${defaultBranch}\`: \`git fetch origin ${defaultBranch}\`, then rebase onto \`origin/${defaultBranch}\` keeping only what isn’t in #${prNumber} (commit or stash uncommitted changes first), resolve any conflicts, and push with \`git push --force-with-lease\`. If anything would be lost, ask before going on.`
  return `${merged} This branch wasn’t moved onto the latest code because ${why[outcome.reason]}. ${steps}`
}
