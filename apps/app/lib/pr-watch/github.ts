import "server-only"

import {
  failingCheckNames,
  isConflicted,
  isMergeBlocked,
  summarizeCheckRuns,
} from "@/lib/pr-checks"
import type { GitHubPrReader, PrLookup, PrTarget } from "./watch"

/** How many of a branch's PRs one lookup reads: the newest is the current
 *  one, the rest refresh the Branch's past PRs (#1701). */
const BRANCH_PR_PAGE = 10

/**
 * PR Watch's GitHub reader: a Branch's newest PR from GitHub's REST API, with
 * an open PR's checks and mergeability. `tokenFor` picks the account each
 * lookup reads with (the browser poll's member, or the tick's Branch owner);
 * no token means no lookup.
 */
export function githubPrReader(
  tokenFor: (target: PrTarget) => Promise<string | null>
): GitHubPrReader {
  return async (target) => {
    const token = await tokenFor(target)
    if (!token) return null
    return fetchBranchPr(token, target)
  }
}

function get(token: string, path: string): Promise<Response> {
  return fetch(`https://api.github.com/repos/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  })
}

async function fetchBranchPr(
  token: string,
  { owner, repo, branch }: PrTarget
): Promise<PrLookup | null> {
  const res = await get(
    token,
    `${owner}/${repo}/pulls?head=${owner}:${branch}&state=all&per_page=${BRANCH_PR_PAGE}&sort=created&direction=desc`
  )
  if (!res.ok) return null

  const data = (await res.json()) as Array<{
    number: number
    html_url: string
    title?: string
    state: "open" | "closed"
    merged_at: string | null
    head: { sha: string }
  }>
  const [pr, ...rest] = data
  if (!pr) return null

  const earlier = rest.map((p) => ({
    number: p.number,
    url: p.html_url,
    ...(p.title ? { title: p.title } : {}),
    state: p.merged_at ? ("merged" as const) : p.state,
  }))
  const state = pr.merged_at ? "merged" : pr.state
  const base = {
    number: pr.number,
    url: pr.html_url,
    ...(pr.title ? { title: pr.title } : {}),
    ...(earlier.length > 0 ? { earlier } : {}),
  }
  if (state !== "open") return { ...base, state }
  const [runs, mergeableState] = await Promise.all([
    fetchCheckRuns(token, owner, repo, pr.head.sha),
    fetchMergeableState(token, owner, repo, pr.number),
  ])
  const checks = runs ? summarizeCheckRuns(runs) : undefined
  const failingChecks = runs ? failingCheckNames(runs) : []
  return {
    ...base,
    state,
    blocked: isMergeBlocked(mergeableState, checks) || undefined,
    ...(checks ? { checks } : {}),
    ...(failingChecks.length > 0 ? { failingChecks } : {}),
    ...(isConflicted(mergeableState) ? { conflict: true } : {}),
  }
}

async function fetchCheckRuns(
  token: string,
  owner: string,
  repo: string,
  sha: string
): Promise<
  | Array<{ name?: string; status: string; conclusion: string | null }>
  | undefined
> {
  const res = await get(
    token,
    `${owner}/${repo}/commits/${sha}/check-runs?per_page=100`
  )
  if (!res.ok) return undefined
  const data = (await res.json()) as {
    check_runs?: Array<{
      name?: string
      status: string
      conclusion: string | null
    }>
  }
  return data.check_runs ?? []
}

/** `mergeable_state` is only on the single-PR endpoint, not the pulls list. */
async function fetchMergeableState(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<string | undefined> {
  const res = await get(token, `${owner}/${repo}/pulls/${number}`)
  if (!res.ok) return undefined
  const data = (await res.json()) as { mergeable_state?: string }
  return data.mergeable_state
}
