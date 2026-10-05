"use server"

import { getGitHubToken } from "@/lib/auth-helpers"
import { githubPrReader } from "@/lib/pr-watch/github"
import { runPrWatch } from "@/lib/pr-watch/run"
import { FIXTURE_GITHUB_REPOS, hasFixtureGitHub } from "@/lib/fixture-github"
import { openRoom, type RoomAccess } from "@/lib/room-access"

export interface GitHubRepo {
  id: number
  fullName: string
  name: string
  private: boolean
  defaultBranch: string
  cloneUrl: string
  htmlUrl: string
  owner: string
  pushedAt: string
}

/**
 * Whether a GitHub API token resolves for the current user — the one thing a
 * client surface needs to know about the token seam to decide whether to offer
 * a GitHub-API-only affordance at all. Reports the boolean, never the token, so
 * the secret stays server-side.
 *
 * `false` is an ordinary state, not an error: the desktop build treats API
 * access as optional (the no-auth floor, ADR 0008), so every GitHub-API feature
 * has to be prepared to stay dark.
 */
export async function hasGitHubToken(): Promise<boolean> {
  // A capture signed in to the fixture account has API access to offer.
  if (await hasFixtureGitHub()) return true
  return (await getGitHubToken()) !== null
}

export async function listUserRepos(): Promise<GitHubRepo[]> {
  if (await hasFixtureGitHub()) return FIXTURE_GITHUB_REPOS
  const token = await getGitHubToken()
  if (!token) return []

  const repos: GitHubRepo[] = []
  let page = 1

  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    )

    // A failed first page is an error the picker shows with a retry; a failed
    // later page keeps what already loaded.
    if (!res.ok) {
      if (page === 1) throw new Error(`GitHub returned ${res.status}`)
      break
    }

    const data = await res.json()
    if (data.length === 0) break

    for (const repo of data) {
      repos.push({
        id: repo.id,
        fullName: repo.full_name,
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        cloneUrl: repo.clone_url,
        htmlUrl: repo.html_url,
        owner: repo.owner.login,
        pushedAt: repo.pushed_at,
      })
    }

    if (data.length < 100) break
    page++
  }

  return repos
}

export interface GitHubBranch {
  name: string
}

export async function createBranch(
  owner: string,
  repo: string,
  newBranchName: string,
  fromBranch: string,
  ghToken?: string
): Promise<{ success: boolean; error?: string }> {
  let token = ghToken
  if (!token) token = (await getGitHubToken()) ?? undefined
  if (!token) return { success: false, error: "No GitHub token" }

  // Get the SHA of the source branch
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  )

  if (!refRes.ok) {
    const err = await refRes.json().catch(() => ({}))
    const detail = err?.message ? `: ${err.message}` : ""
    return {
      success: false,
      error: `Failed to get ref for ${fromBranch} (${refRes.status})${detail}`,
    }
  }

  const refData = await refRes.json()
  const sha = refData.object.sha

  // Create the new branch
  const createRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: `refs/heads/${newBranchName}`,
        sha,
      }),
    }
  )

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}))
    return {
      success: false,
      error: err.message || `Failed to create branch ${newBranchName}`,
    }
  }

  return { success: true }
}

export async function renameBranch(
  owner: string,
  repo: string,
  oldBranch: string,
  newBranch: string,
  ghToken?: string
): Promise<{ success: boolean; error?: string }> {
  const token = ghToken ?? (await getGitHubToken())
  if (!token) return { success: false, error: "No GitHub token" }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${oldBranch}/rename`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ new_name: newBranch }),
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return {
      success: false,
      error:
        err.message || `Failed to rename branch ${oldBranch} to ${newBranch}`,
    }
  }

  return { success: true }
}

export async function deleteBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getGitHubToken()
  if (!token) return { success: false, error: "No GitHub token" }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  )

  // 204 No Content = deleted; 422 typically means the ref doesn't exist (already gone).
  if (res.status === 204 || res.status === 422) return { success: true }

  const err = await res.json().catch(() => ({}))
  return {
    success: false,
    error: err.message || `Failed to delete branch ${branch} (${res.status})`,
  }
}

export interface DiffStats {
  additions: number
  deletions: number
}

/** Token-injected core of the compare call. Callers fetch the token once and
 *  fan this out in parallel — see {@link compareBranches}. */
async function fetchCompare(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<DiffStats | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  )

  if (!res.ok) return null

  const data = await res.json()
  let additions = 0
  let deletions = 0
  for (const file of data.files ?? []) {
    additions += file.additions ?? 0
    deletions += file.deletions ?? 0
  }
  return { additions, deletions }
}

export interface DiffStatQuery {
  /** Branch id — keys the result and the doc entry the stats are cached into. */
  id: string
  owner: string
  repo: string
  base: string
  head: string
}

/**
 * Diff stats for many branches in ONE server action. The previous per-branch
 * action meant N calls that React's server-action queue ran *sequentially* —
 * N round-trips end to end. Here the token is fetched once and the GitHub
 * compares run in a real server-side `Promise.all`, so it's a single round-trip
 * with parallel fan-out. Results are also cached into the room's Y.Doc so a
 * cold load renders the badges instantly and other clients don't each re-fetch.
 */
export async function compareBranches(
  roomId: string,
  queries: DiffStatQuery[]
): Promise<Array<{ id: string; stats: DiffStats | null }>> {
  if (queries.length === 0) return []
  // Membership first: a non-member is rejected before any GitHub call, and
  // the write-through below can only reach the room through this handle.
  const room = await openRoom(roomId)
  const token = await getGitHubToken()
  if (!token) return queries.map((q) => ({ id: q.id, stats: null }))

  const results = await Promise.all(
    queries.map(async (q) => ({
      id: q.id,
      stats: await fetchCompare(token, q.owner, q.repo, q.base, q.head),
    }))
  )
  await cacheDiffStats(room, results)
  return results
}

/** Write-through to the doc. Only branches whose stats actually changed emit a
 *  Yjs update; a failed compare (`null`) leaves the last-known value untouched
 *  rather than clearing the badge. Runs server-side, so the update reaches
 *  clients as a remote change and never lands in their undo history. */
async function cacheDiffStats(
  room: RoomAccess,
  results: Array<{ id: string; stats: DiffStats | null }>
): Promise<void> {
  if (!results.some((r) => r.stats)) return
  await room.mutateDoc(({ branches }) => {
    for (const { id, stats } of results) {
      if (!stats) continue
      const cur = branches.get(id)
      if (!cur) continue
      if (
        cur.diffAdditions !== stats.additions ||
        cur.diffDeletions !== stats.deletions
      ) {
        branches.update(id, {
          diffAdditions: stats.additions,
          diffDeletions: stats.deletions,
        })
      }
    }
  })
}

export type BranchPrState = "open" | "closed" | "merged"

export interface BranchPrInfo {
  number: number
  url: string
  state: BranchPrState
  /** Its title, when the lookup read it. */
  title?: string
  /** An open PR that can't merge: failing checks, a conflict, or a missing
   *  required review or check. Only looked up for open PRs. */
  blocked?: boolean
}

/**
 * PR status for the Room's Branches in ONE server action, through PR Watch
 * (#1702): it looks up every Branch's PR with the caller's GitHub account
 * (GitHub calls fanned out in parallel server-side), writes what changed into
 * the doc, and adds any PR event (checks failed, merged…) to the Branch's
 * Workspace Chat. The Branches come from the doc, not the caller. Returns
 * nothing new while another look at the same Room is running: that look
 * writes the doc.
 */
export async function listBranchPrs(
  roomId: string
): Promise<Array<{ id: string; pr: BranchPrInfo | null }>> {
  // Membership first: a non-member is rejected before any GitHub call, and
  // the write-through can only reach the room through this handle.
  const room = await openRoom(roomId)
  const token = await getGitHubToken()
  if (!token) return []
  const result = await runPrWatch(
    room,
    githubPrReader(async () => token),
    { fallbackUserId: room.userId }
  )
  return (result?.prs ?? []).map(({ id, pr }) => ({
    id,
    pr: pr && {
      number: pr.number,
      url: pr.url,
      state: pr.state,
      ...(pr.blocked ? { blocked: true } : {}),
    },
  }))
}

export async function listRepoBranches(
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  const token = await getGitHubToken()
  if (!token) return []

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  )

  if (!res.ok) return []

  const data = await res.json()
  return data.map((b: { name: string }) => ({ name: b.name }))
}
