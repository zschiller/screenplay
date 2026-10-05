/**
 * GitHub issues and comments over the REST API, for the agent's GitHub tools
 * (`lib/agent/github-tools.ts`). Every call runs with one person's token, so
 * what an agent reads and writes is what that person could, and anything it
 * posts is attributed to them. Pull requests are issues to this API: reading,
 * commenting on and closing one goes through the same endpoints.
 */

export interface GitHubRepoRef {
  owner: string
  name: string
}

export interface GitHubIssuesClient {
  search(input: {
    repo: GitHubRepoRef
    query?: string
    state: "open" | "closed" | "all"
    kind: "issue" | "pr" | "any"
  }): Promise<IssueSummary[]>
  read(repo: GitHubRepoRef, number: number): Promise<IssueThread>
  create(
    repo: GitHubRepoRef,
    input: { title: string; body?: string; labels?: string[] }
  ): Promise<IssueRef>
  comment(
    repo: GitHubRepoRef,
    number: number,
    input: { body: string; replyTo?: number }
  ): Promise<{ url: string }>
  update(
    repo: GitHubRepoRef,
    number: number,
    input: IssueUpdate
  ): Promise<IssueRef & { state: string }>
  /** Adds (or removes) a native blocking edge or sub-issue link. */
  link(
    repo: GitHubRepoRef,
    number: number,
    relation: IssueRelation,
    other: number,
    remove?: boolean
  ): Promise<void>
  /** The repository's labels, with their descriptions. */
  labels(
    repo: GitHubRepoRef
  ): Promise<Array<{ name: string; description: string | null }>>
  /** A pull request's changed files, with each one's patch. */
  files(repo: GitHubRepoRef, number: number): Promise<PrFiles>
  /** A pull request's head commit, mergeability and check runs. */
  checks(repo: GitHubRepoRef, number: number): Promise<PrChecks>
  /** Submits a review: approve, request changes, or comment, with line comments. */
  review(
    repo: GitHubRepoRef,
    number: number,
    input: PrReview
  ): Promise<{ url: string }>
  /** The merge methods the repository allows, its preferred one first. */
  mergeMethods(repo: GitHubRepoRef): Promise<MergeMethod[]>
  /** Merges a pull request, only while its head is still `sha`. */
  merge(
    repo: GitHubRepoRef,
    number: number,
    input: { method: MergeMethod; sha: string }
  ): Promise<{ sha: string }>
}

export type MergeMethod = "squash" | "merge" | "rebase"

export interface PrReview {
  event: "approve" | "request_changes" | "comment"
  body?: string
  /** Comments on lines of the diff's new side. */
  comments?: Array<{ path: string; line: number; body: string }>
}

export interface PrFiles {
  files: Array<{
    path: string
    /** added, removed, modified, renamed… */
    status: string
    additions: number
    deletions: number
    /** Absent for a binary or very large file. */
    patch?: string
    previousPath?: string
  }>
  more: boolean
}

export interface PrChecks {
  title: string
  url: string
  draft: boolean
  sha: string
  state: string
  /** GitHub's `mergeable_state`: clean, dirty (a conflict), blocked… */
  mergeableState: string | null
  runs: Array<{
    name: string
    status: string
    conclusion: string | null
    url: string
    title: string | null
    summary: string | null
  }>
}

export interface IssueRef {
  number: number
  url: string
}

export interface IssueSummary extends IssueRef {
  title: string
  state: string
  isPullRequest: boolean
  author: string
  comments: number
  labels: string[]
  updatedAt: string
}

export interface IssueComment {
  /** Set on a review comment, the id a reply goes to. */
  id?: number
  author: string
  createdAt: string
  body: string
  /** A review comment's `path:line`, or "review" for a review's summary. */
  on?: string
}

export interface IssueThread extends IssueSummary {
  body: string
  /** "completed", "not_planned", "merged" — why a closed one closed. */
  stateReason: string | null
  /** Every comment, review and review comment, oldest first. */
  timeline: IssueComment[]
  /** More comments exist than were read. */
  truncated: boolean
  /** Its native links: what blocks it, what it blocks, its parent and sub-issues. */
  relations: IssueRelations
}

export interface IssueRelations {
  blockedBy: IssueSummary[]
  blocking: IssueSummary[]
  parent: IssueSummary | null
  subIssues: IssueSummary[]
}

/**
 * A native link between two issues, read from `number`: `blocked_by` means
 * `number` waits on `other`, `parent_of` makes `other` its sub-issue.
 */
export type IssueRelation = "blocked_by" | "blocks" | "parent_of" | "child_of"

export interface IssueUpdate {
  state?: "open" | "closed"
  reason?: "completed" | "not_planned"
  title?: string
  body?: string
  labels?: string[]
}

const API = "https://api.github.com"
/** Pages of 100 read per list: the newest past this are left out. */
const MAX_PAGES = 5

type Fetch = typeof fetch

/** GitHub's error, as the message an agent reads. */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function errorOf(res: Response): Promise<GitHubApiError> {
  let message = `GitHub API error (${res.status})`
  try {
    const json = (await res.json()) as {
      message?: string
      errors?: Array<{ message?: string; code?: string; field?: string }>
    }
    if (json.message) message = `${json.message} (${res.status})`
    const detail = (json.errors ?? [])
      .map((e) => e.message ?? (e.field && `${e.field} ${e.code}`))
      .filter(Boolean)
      .join("; ")
    if (detail) message = `${message}: ${detail}`
  } catch {}
  return new GitHubApiError(res.status, message)
}

type RawUser = { login?: string } | null
type RawIssue = {
  number: number
  html_url: string
  title: string
  state: string
  state_reason?: string | null
  body?: string | null
  user: RawUser
  comments: number
  labels: Array<string | { name?: string }>
  updated_at: string
  pull_request?: { merged_at?: string | null }
  id?: number
  parent_issue_url?: string | null
  sub_issues_summary?: { total: number } | null
  issue_dependencies_summary?: {
    total_blocked_by: number
    total_blocking: number
  } | null
}
type RawComment = {
  id: number
  user: RawUser
  created_at?: string
  submitted_at?: string
  body?: string | null
  path?: string
  line?: number | null
  original_line?: number | null
  state?: string
}

const login = (u: RawUser) => u?.login ?? "ghost"

function summary(raw: RawIssue): IssueSummary {
  return {
    number: raw.number,
    url: raw.html_url,
    title: raw.title,
    state:
      raw.pull_request?.merged_at && raw.state === "closed"
        ? "merged"
        : raw.state,
    isPullRequest: Boolean(raw.pull_request),
    author: login(raw.user),
    comments: raw.comments,
    labels: raw.labels
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean),
    updatedAt: raw.updated_at,
  }
}

/** The client, on one token. `fetchImpl` stands in for GitHub in tests. */
export function gitHubIssuesClient(
  token: string,
  fetchImpl: Fetch = fetch
): GitHubIssuesClient {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const path = (repo: GitHubRepoRef, rest: string) =>
    `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}${rest}`

  async function call<T>(
    url: string,
    init?: { method: string; body?: unknown }
  ): Promise<T> {
    const res = await fetchImpl(url, {
      method: init?.method ?? "GET",
      headers:
        init?.body !== undefined
          ? { ...headers, "Content-Type": "application/json" }
          : headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    if (!res.ok) throw await errorOf(res)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  /** Every page of a list, up to {@link MAX_PAGES}; `more` when cut. */
  async function list<T>(url: string): Promise<{ items: T[]; more: boolean }> {
    const items: T[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await call<T[]>(`${url}?per_page=100&page=${page}`)
      items.push(...batch)
      if (batch.length < 100) return { items, more: false }
    }
    return { items, more: true }
  }

  /** Only asks GitHub for the links its summaries say exist. */
  async function relationsOf(
    repo: GitHubRepoRef,
    issue: RawIssue
  ): Promise<IssueRelations> {
    const deps = issue.issue_dependencies_summary
    const n = issue.number
    const [blockedBy, blocking, subIssues, parent] = await Promise.all([
      deps?.total_blocked_by
        ? call<RawIssue[]>(path(repo, `/issues/${n}/dependencies/blocked_by`))
        : [],
      deps?.total_blocking
        ? call<RawIssue[]>(path(repo, `/issues/${n}/dependencies/blocking`))
        : [],
      issue.sub_issues_summary?.total
        ? call<RawIssue[]>(path(repo, `/issues/${n}/sub_issues?per_page=100`))
        : [],
      issue.parent_issue_url
        ? call<RawIssue>(path(repo, `/issues/${n}/parent`))
        : null,
    ])
    return {
      blockedBy: blockedBy.map(summary),
      blocking: blocking.map(summary),
      subIssues: subIssues.map(summary),
      parent: parent ? summary(parent) : null,
    }
  }

  /** An issue's id, which the link endpoints take instead of its number. */
  async function idOf(repo: GitHubRepoRef, number: number): Promise<number> {
    const raw = await call<RawIssue>(path(repo, `/issues/${number}`))
    if (raw.id === undefined) throw new Error(`#${number} has no id`)
    return raw.id
  }

  return {
    async search({ repo, query, state, kind }) {
      const q = [
        `repo:${repo.owner}/${repo.name}`,
        kind === "issue" ? "is:issue" : kind === "pr" ? "is:pr" : "",
        state === "all" ? "" : `is:${state}`,
        query?.trim() ?? "",
      ]
        .filter(Boolean)
        .join(" ")
      const data = await call<{ items: RawIssue[] }>(
        `${API}/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=30`
      )
      return data.items.map(summary)
    },

    async read(repo, number) {
      const issue = await call<RawIssue>(path(repo, `/issues/${number}`))
      const comments = await list<RawComment>(
        path(repo, `/issues/${number}/comments`)
      )
      const timeline: IssueComment[] = comments.items.map((c) => ({
        author: login(c.user),
        createdAt: c.created_at ?? "",
        body: c.body ?? "",
      }))
      let more = comments.more
      if (issue.pull_request) {
        const [reviews, reviewComments] = await Promise.all([
          list<RawComment>(path(repo, `/pulls/${number}/reviews`)),
          list<RawComment>(path(repo, `/pulls/${number}/comments`)),
        ])
        more ||= reviews.more || reviewComments.more
        for (const r of reviews.items) {
          // A review with no summary is only the container of its comments.
          if (!r.body?.trim() && r.state === "COMMENTED") continue
          timeline.push({
            author: login(r.user),
            createdAt: r.submitted_at ?? "",
            body: r.body ?? "",
            on: `review: ${(r.state ?? "").toLowerCase().replace(/_/g, " ")}`,
          })
        }
        for (const c of reviewComments.items) {
          const line = c.line ?? c.original_line
          timeline.push({
            id: c.id,
            author: login(c.user),
            createdAt: c.created_at ?? "",
            body: c.body ?? "",
            on: line ? `${c.path}:${line}` : c.path,
          })
        }
      }
      timeline.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const relations = await relationsOf(repo, issue)
      return {
        ...summary(issue),
        body: issue.body ?? "",
        stateReason: issue.state_reason ?? null,
        timeline,
        truncated: more,
        relations,
      }
    },

    async create(repo, { title, body, labels }) {
      const raw = await call<RawIssue>(path(repo, "/issues"), {
        method: "POST",
        body: { title, body: body ?? "", ...(labels ? { labels } : {}) },
      })
      return { number: raw.number, url: raw.html_url }
    },

    async comment(repo, number, { body, replyTo }) {
      const raw = await call<{ html_url: string }>(
        replyTo
          ? path(repo, `/pulls/${number}/comments/${replyTo}/replies`)
          : path(repo, `/issues/${number}/comments`),
        { method: "POST", body: { body } }
      )
      return { url: raw.html_url }
    },

    async update(repo, number, { state, reason, title, body, labels }) {
      const raw = await call<RawIssue>(path(repo, `/issues/${number}`), {
        method: "PATCH",
        body: {
          ...(state ? { state } : {}),
          ...(state === "closed" && reason ? { state_reason: reason } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(labels ? { labels } : {}),
        },
      })
      const s = summary(raw)
      return { number: s.number, url: s.url, state: s.state }
    },

    async link(repo, number, relation, other, remove = false) {
      // Every link is stored on one side: the blocked issue, or the parent.
      const [owner, target] =
        relation === "blocked_by" || relation === "parent_of"
          ? [number, other]
          : [other, number]
      const id = await idOf(repo, target)
      const blocking = relation === "blocked_by" || relation === "blocks"
      if (blocking) {
        const base = `/issues/${owner}/dependencies/blocked_by`
        await (remove
          ? call(path(repo, `${base}/${id}`), { method: "DELETE" })
          : call(path(repo, base), { method: "POST", body: { issue_id: id } }))
      } else {
        await (remove
          ? call(path(repo, `/issues/${owner}/sub_issue`), {
              method: "DELETE",
              body: { sub_issue_id: id },
            })
          : call(path(repo, `/issues/${owner}/sub_issues`), {
              method: "POST",
              body: { sub_issue_id: id },
            }))
      }
    },

    async labels(repo) {
      const listed = await list<{ name: string; description?: string | null }>(
        path(repo, "/labels")
      )
      return listed.items.map((l) => ({
        name: l.name,
        description: l.description ?? null,
      }))
    },

    async files(repo, number) {
      const listed = await list<{
        filename: string
        status: string
        additions: number
        deletions: number
        patch?: string
        previous_filename?: string
      }>(path(repo, `/pulls/${number}/files`))
      return {
        files: listed.items.map((f) => ({
          path: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
          previousPath: f.previous_filename,
        })),
        more: listed.more,
      }
    },

    async checks(repo, number) {
      const pr = await call<{
        title: string
        html_url: string
        draft?: boolean
        state: string
        merged: boolean
        mergeable_state?: string | null
        head: { sha: string }
      }>(path(repo, `/pulls/${number}`))
      const data = await call<{
        check_runs: Array<{
          name: string
          status: string
          conclusion: string | null
          html_url: string
          output?: { title?: string | null; summary?: string | null }
        }>
      }>(path(repo, `/commits/${pr.head.sha}/check-runs?per_page=100`))
      return {
        title: pr.title,
        url: pr.html_url,
        draft: pr.draft ?? false,
        sha: pr.head.sha,
        state: pr.merged ? "merged" : pr.state,
        mergeableState: pr.mergeable_state ?? null,
        runs: data.check_runs.map((r) => ({
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
          url: r.html_url,
          title: r.output?.title ?? null,
          summary: r.output?.summary ?? null,
        })),
      }
    },

    async review(repo, number, { event, body, comments }) {
      const raw = await call<{ html_url: string }>(
        path(repo, `/pulls/${number}/reviews`),
        {
          method: "POST",
          body: {
            event: event.toUpperCase(),
            ...(body ? { body } : {}),
            ...(comments?.length
              ? {
                  comments: comments.map((c) => ({
                    path: c.path,
                    line: c.line,
                    side: "RIGHT",
                    body: c.body,
                  })),
                }
              : {}),
          },
        }
      )
      return { url: raw.html_url }
    },

    async mergeMethods(repo) {
      const raw = await call<{
        allow_squash_merge?: boolean
        allow_merge_commit?: boolean
        allow_rebase_merge?: boolean
      }>(path(repo, ""))
      const methods: MergeMethod[] = []
      if (raw.allow_squash_merge !== false) methods.push("squash")
      if (raw.allow_merge_commit !== false) methods.push("merge")
      if (raw.allow_rebase_merge !== false) methods.push("rebase")
      return methods
    },

    async merge(repo, number, { method, sha }) {
      const raw = await call<{ sha: string }>(
        path(repo, `/pulls/${number}/merge`),
        { method: "PUT", body: { merge_method: method, sha } }
      )
      return { sha: raw.sha }
    },
  }
}
