"use server"

import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { canvasGitHubRepos, pickCanvasRepo } from "@/lib/canvas-github-repos"
import {
  gitHubIssuesClient,
  type GitHubIssuesClient,
  type GitHubRepoRef,
  type MergeMethod,
} from "@/lib/github-issues"
import { summarizeCheckRuns, type BranchPrChecks } from "@/lib/pr-checks"
import { openRoom } from "@/lib/room-access"

/**
 * The merge card's server side: an agent's `merge_pr` only shows the card, and
 * a pull request merges when a member presses Merge on it, with their own
 * GitHub account. Both actions reach only the canvas's repositories.
 */

/** A merge card's pull request, as `owner/name` and number. */
export interface OfferedMerge {
  repo: string
  number: number
}

export interface OfferedMergeState {
  title: string
  url: string
  /** open, closed or merged. */
  state: string
  draft: boolean
  /** GitHub's `mergeable_state`: dirty is a conflict. */
  mergeableState: string | null
  checks: BranchPrChecks | undefined
  /** The head the card merges; a newer push makes the merge fail. */
  sha: string
  methods: MergeMethod[]
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

async function open(
  roomId: string,
  named: string
): Promise<
  | { ok: true; repo: GitHubRepoRef; client: GitHubIssuesClient; role: string }
  | { ok: false; error: string }
> {
  const room = await openRoom(roomId)
  const repos = await room.readDoc(canvasGitHubRepos)
  const picked = pickCanvasRepo(repos, named)
  if ("error" in picked) return { ok: false, error: picked.error }
  const token = await getGitHubTokenForUser(room.userId)
  if (!token) return { ok: false, error: "Connect GitHub to merge." }
  return {
    ok: true,
    repo: picked.repo,
    client: gitHubIssuesClient(token),
    role: room.role,
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** What a merge card shows: the pull request's state, checks and merge methods. */
export async function offeredMergeState(
  roomId: string,
  offered: OfferedMerge
): Promise<Result<OfferedMergeState>> {
  const opened = await open(roomId, offered.repo)
  if (!opened.ok) return opened
  try {
    const [pr, methods] = await Promise.all([
      opened.client.checks(opened.repo, offered.number),
      opened.client.mergeMethods(opened.repo),
    ])
    return {
      ok: true,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      draft: pr.draft,
      mergeableState: pr.mergeableState,
      checks: summarizeCheckRuns(pr.runs),
      sha: pr.sha,
      methods,
    }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

/**
 * Merge a card's pull request, from its Merge button, as the member who
 * pressed it. Only at the head the card showed, so a push after it fails the
 * merge instead of merging code nobody saw. Viewers can't merge.
 */
export async function mergeOfferedPr(
  roomId: string,
  offered: OfferedMerge & { method: MergeMethod; sha: string }
): Promise<Result<{ sha: string }>> {
  const opened = await open(roomId, offered.repo)
  if (!opened.ok) return opened
  if (opened.role === "viewer") {
    return { ok: false, error: "Viewers can’t merge on this canvas." }
  }
  try {
    const merged = await opened.client.merge(opened.repo, offered.number, {
      method: offered.method,
      sha: offered.sha,
    })
    return { ok: true, sha: merged.sha }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}
