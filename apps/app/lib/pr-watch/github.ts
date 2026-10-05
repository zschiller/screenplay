import "server-only"

import { isAgentPost } from "@/lib/agent-post-mark"
import {
  failingCheckNames,
  isConflicted,
  isMergeBlocked,
  summarizeCheckRuns,
} from "@/lib/pr-checks"
import type { PrReviewVerdict } from "./events"
import type { GitHubPrReader, PrLookup, PrReviewRead, PrTarget } from "./watch"

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
  { owner, repo, branch, reviewsSince }: PrTarget
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
    created_at: string
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
  const since = reviewsSince?.number === pr.number ? reviewsSince.at : undefined
  const [runs, mergeableState, reviews] = await Promise.all([
    fetchCheckRuns(token, owner, repo, pr.head.sha),
    fetchMergeableState(token, owner, repo, pr.number),
    fetchReviews(token, owner, repo, pr.number, pr.created_at, since),
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
    ...(reviews ? { reviews } : {}),
  }
}

/** GitHub's review states PR Watch reports; pending (a draft only its
 *  author sees) and dismissed reviews aren't news. */
const VERDICTS: Record<string, PrReviewVerdict> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
}

type RawReview = {
  id: number
  user: { login: string } | null
  body: string | null
  state: string
  submitted_at?: string | null
  html_url: string
}

/**
 * An open PR's reviews (#1704): the newest submit time, and the reviews after
 * `since` with their line comments counted. Reviews list oldest first, so the
 * newest are on the last page. No `since` (a PR seen for the first time) is a
 * baseline: no review is read in full.
 */
async function fetchReviews(
  token: string,
  owner: string,
  repo: string,
  number: number,
  createdAt: string,
  since: string | undefined
): Promise<PrLookup["reviews"]> {
  const base = `${owner}/${repo}/pulls/${number}/reviews?per_page=100`
  let res = await get(token, base)
  if (!res.ok) return undefined
  const last = lastPage(res.headers.get("link"))
  if (last) {
    res = await get(token, `${base}&page=${last}`)
    if (!res.ok) return undefined
  }
  const submitted = ((await res.json()) as RawReview[]).filter(
    (r): r is RawReview & { submitted_at: string } =>
      !!r.submitted_at && r.state in VERDICTS
  )
  const latestAt = submitted.reduce(
    (at, r) => (r.submitted_at > at ? r.submitted_at : at),
    createdAt
  )
  if (!since) return { latestAt, fresh: [] }
  const fresh = await Promise.all(
    submitted
      .filter((r) => r.submitted_at > since)
      .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
      .map((r) => readReview(token, owner, repo, number, r))
  )
  if (fresh.some((r) => !r)) return undefined
  return { latestAt, fresh: fresh as PrReviewRead[] }
}

/** One review with its line comments counted. A review the agent posted
 *  carries the mark in its summary, or, when it's only a reply in a thread,
 *  in its comments. `null` when the comments couldn't be read. */
async function readReview(
  token: string,
  owner: string,
  repo: string,
  number: number,
  review: RawReview & { submitted_at: string }
): Promise<PrReviewRead | null> {
  const res = await get(
    token,
    `${owner}/${repo}/pulls/${number}/reviews/${review.id}/comments?per_page=100`
  )
  if (!res.ok) return null
  const comments = (await res.json()) as Array<{ body: string | null }>
  const byAgent =
    isAgentPost(review.body) ||
    (!review.body?.trim() &&
      comments.length > 0 &&
      comments.every((c) => isAgentPost(c.body)))
  return {
    author: review.user?.login ?? "someone",
    verdict: VERDICTS[review.state]!,
    comments: comments.length,
    submittedAt: review.submitted_at,
    url: review.html_url,
    ...(byAgent ? { byAgent: true } : {}),
  }
}

/** The `last` page number in a GitHub `Link` header, if there's more than
 *  one page. */
function lastPage(link: string | null): number | undefined {
  const match = link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/)
  return match ? Number(match[1]) : undefined
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
