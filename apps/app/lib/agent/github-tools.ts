import "server-only"

import { tool } from "ai"
import { z } from "zod"

import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import {
  gitHubIssuesClient,
  type GitHubIssuesClient,
  type GitHubRepoRef,
  type IssueSummary,
  type IssueThread,
  type PrChecks,
  type PrFiles,
} from "@/lib/github-issues"
import { canvasGitHubRepos, pickCanvasRepo } from "@/lib/canvas-github-repos"
import { annotateTools } from "@/lib/mcp/tool-server"
import type { RoomReader } from "@/lib/room-access"

/**
 * A chat's GitHub tools: search and read issues and pull requests with their
 * comments, open issues, comment, close or reopen, link them with GitHub's
 * native blocking edges and sub-issues, list labels; and read a pull
 * request's diff and CI checks. Workspace chats and
 * the Coordinator get them, in process and over the harness MCP route, like
 * `create_pr`. They reach only the canvas's repositories, and run with the
 * GitHub account of the member the turn runs for, so a comment or issue is
 * theirs on GitHub. A turn nobody sent (a Coordinator wake) can read but not
 * write.
 */
export interface GitHubToolContext {
  room: RoomReader
  /** A Workspace chat's Sandbox, whose repository is the default. */
  sandboxName?: string
  userId: string
  /** A turn nobody sent, which refuses writes. */
  senderless?: boolean
  /** Stand-ins for the token store and GitHub, in tests. */
  token?: (userId: string) => Promise<string | null>
  client?: (token: string) => GitHubIssuesClient
}

/** A read's longest output; the rest of a long thread is cut. */
const MAX_OUTPUT = 60_000

const repoParam = z
  .string()
  .optional()
  .describe(
    "The repository as owner/name. Defaults to this Workspace’s repository, or the canvas’s only one."
  )

/** What merge_pr tells the agent about the card it showed. */
const MERGE_CARD_NOTE =
  "whether it merged reaches you only if you read the pull request again later."

const numberParam = z
  .number()
  .int()
  .positive()
  .describe("The issue or pull request number.")

export function buildGitHubTools(ctx: GitHubToolContext) {
  const tokenFor = ctx.token ?? getGitHubTokenForUser
  const clientFor = ctx.client ?? ((token) => gitHubIssuesClient(token))

  async function resolve(
    repo: string | undefined,
    write: boolean
  ): Promise<
    { repo: GitHubRepoRef; client: GitHubIssuesClient } | { error: string }
  > {
    if (write && ctx.senderless) {
      return {
        error:
          "Nothing changed on GitHub: nobody sent this turn, so there is no one to post as. Tell the user what you’d post instead.",
      }
    }
    const { repos, own } = await ctx.room.readDoc((c) => ({
      repos: canvasGitHubRepos(c),
      own: ctx.sandboxName
        ? c.branches.toArray().find((b) => b.sandboxName === ctx.sandboxName)
            ?.repoId
        : undefined,
    }))
    const picked = pickCanvasRepo(repos, repo, own)
    if ("error" in picked) return picked
    const token = await tokenFor(ctx.userId)
    if (!token) {
      return {
        error:
          "Nothing reached GitHub: the member this turn runs for hasn’t connected a GitHub account.",
      }
    }
    return {
      repo: { owner: picked.repo.owner, name: picked.repo.name },
      client: clientFor(token),
    }
  }

  const failed = (e: unknown) =>
    `GitHub said: ${e instanceof Error ? e.message : String(e)}`

  const tools = {
    search_issues: tool({
      description:
        "List or search a repository’s GitHub issues and pull requests, newest activity first (up to 30). `query` takes GitHub search syntax, such as words, `label:bug`, `author:octocat` or `in:title`. Read one with read_issue.",
      inputSchema: z.object({
        query: z.string().optional(),
        state: z.enum(["open", "closed", "all"]).optional(),
        kind: z
          .enum(["issue", "pr", "any"])
          .optional()
          .describe("Issues, pull requests or both (the default)."),
        repo: repoParam,
      }),
      execute: async ({ query, state, kind, repo }) => {
        const r = await resolve(repo, false)
        if ("error" in r) return r.error
        try {
          const found = await r.client.search({
            repo: r.repo,
            query,
            state: state ?? "open",
            kind: kind ?? "any",
          })
          if (found.length === 0) return "Nothing matched."
          return found.map(summaryLine).join("\n")
        } catch (e) {
          return failed(e)
        }
      },
    }),

    read_issue: tool({
      description:
        "Read a GitHub issue or pull request: its description and every comment, oldest first. On a pull request that includes reviews and review comments on code lines; reply to one of those with comment_on_issue’s `replyTo`.",
      inputSchema: z.object({ number: numberParam, repo: repoParam }),
      execute: async ({ number, repo }) => {
        const r = await resolve(repo, false)
        if ("error" in r) return r.error
        try {
          return formatThread(await r.client.read(r.repo, number))
        } catch (e) {
          return failed(e)
        }
      },
    }),

    create_issue: tool({
      description:
        "Open a GitHub issue, as the member this turn runs for. Only when the user asks for one. `body` is markdown; `labels` must already exist in the repository.",
      inputSchema: z.object({
        title: z.string().min(1),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        repo: repoParam,
      }),
      execute: async ({ title, body, labels, repo }) => {
        const r = await resolve(repo, true)
        if ("error" in r) return r.error
        try {
          const { number, url } = await r.client.create(r.repo, {
            title,
            body,
            labels,
          })
          return `Created issue #${number}: ${url}`
        } catch (e) {
          return failed(e)
        }
      },
    }),

    comment_on_issue: tool({
      description:
        "Post a markdown comment on a GitHub issue or pull request, as the member this turn runs for. `replyTo` answers a pull request’s review comment in its thread, by the id read_issue shows.",
      inputSchema: z.object({
        number: numberParam,
        body: z.string().min(1),
        replyTo: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("A review comment’s id, to reply in its thread."),
        repo: repoParam,
      }),
      execute: async ({ number, body, replyTo, repo }) => {
        const r = await resolve(repo, true)
        if ("error" in r) return r.error
        try {
          const { url } = await r.client.comment(r.repo, number, {
            body,
            replyTo,
          })
          return `Commented on #${number}: ${url}`
        } catch (e) {
          return failed(e)
        }
      },
    }),

    update_issue: tool({
      description:
        "Close, reopen, retitle, rewrite or relabel a GitHub issue or pull request, as the member this turn runs for. Closing takes a `reason`: completed (the default) or not_planned. `labels` replaces the whole set.",
      inputSchema: z.object({
        number: numberParam,
        state: z.enum(["open", "closed"]).optional(),
        reason: z.enum(["completed", "not_planned"]).optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        repo: repoParam,
      }),
      execute: async ({ number, repo, ...change }) => {
        const r = await resolve(repo, true)
        if ("error" in r) return r.error
        try {
          const { url, state } = await r.client.update(r.repo, number, change)
          const verb =
            change.state === "closed"
              ? "Closed"
              : change.state === "open"
                ? "Reopened"
                : "Updated"
          return `${verb} #${number} (now ${state}): ${url}`
        } catch (e) {
          return failed(e)
        }
      },
    }),

    link_issues: tool({
      description:
        "Add or remove GitHub’s native link between two issues in the same repository. `blocked_by`: `number` waits on `other`. `blocks`: `other` waits on `number`. `parent_of`: `other` becomes a sub-issue of `number`. `child_of`: `number` becomes a sub-issue of `other`. Posts as the member this turn runs for, and only when the user asks. read_issue shows the links.",
      inputSchema: z.object({
        number: numberParam,
        relation: z.enum(["blocked_by", "blocks", "parent_of", "child_of"]),
        other: z
          .number()
          .int()
          .positive()
          .describe("The other issue’s number."),
        remove: z.boolean().optional().describe("Remove the link instead."),
        repo: repoParam,
      }),
      execute: async ({ number, relation, other, remove, repo }) => {
        const r = await resolve(repo, true)
        if ("error" in r) return r.error
        try {
          await r.client.link(r.repo, number, relation, other, remove)
          const phrase = {
            blocked_by: `#${number} blocked by #${other}`,
            blocks: `#${number} blocking #${other}`,
            parent_of: `#${other} as a sub-issue of #${number}`,
            child_of: `#${number} as a sub-issue of #${other}`,
          }[relation]
          return `${remove ? "Removed" : "Linked"} ${phrase}.`
        } catch (e) {
          return failed(e)
        }
      },
    }),

    list_labels: tool({
      description:
        "List the repository’s GitHub labels with their descriptions, to pick existing ones for create_issue or update_issue.",
      inputSchema: z.object({ repo: repoParam }),
      execute: async ({ repo }) => {
        const r = await resolve(repo, false)
        if ("error" in r) return r.error
        try {
          const labels = await r.client.labels(r.repo)
          if (labels.length === 0) return "The repository has no labels."
          return labels
            .map((l) =>
              l.description ? `${l.name}: ${l.description}` : l.name
            )
            .join("\n")
        } catch (e) {
          return failed(e)
        }
      },
    }),

    review_pr: tool({
      description:
        "Submit a review on a GitHub pull request, as the member this turn runs for, and only when the user asks: approve, request_changes or comment, with a markdown `body` and optional `comments` on lines of the diff’s new side (read them with read_pr_diff). GitHub doesn’t let anyone approve their own pull request.",
      inputSchema: z.object({
        number: numberParam,
        event: z.enum(["approve", "request_changes", "comment"]),
        body: z.string().optional(),
        comments: z
          .array(
            z.object({
              path: z.string(),
              line: z.number().int().positive(),
              body: z.string().min(1),
            })
          )
          .optional(),
        repo: repoParam,
      }),
      execute: async ({ number, event, body, comments, repo }) => {
        const r = await resolve(repo, true)
        if ("error" in r) return r.error
        try {
          const { url } = await r.client.review(r.repo, number, {
            event,
            body,
            comments,
          })
          const verb = {
            approve: "Approved",
            request_changes: "Requested changes on",
            comment: "Reviewed",
          }[event]
          return `${verb} #${number}: ${url}`
        } catch (e) {
          return failed(e)
        }
      },
    }),

    merge_pr: tool({
      description: `Offer to merge a GitHub pull request: the chat shows a card with its checks and a Merge button, and it merges only when a member presses it, with their GitHub account. Only when the user asks for a merge. \`method\` (squash, merge or rebase) defaults to the repository’s first allowed one. After calling this, end your turn; ${MERGE_CARD_NOTE}`,
      inputSchema: z.object({
        number: numberParam,
        method: z.enum(["squash", "merge", "rebase"]).optional(),
        repo: repoParam,
      }),
      execute: async ({ number, repo }) => {
        const r = await resolve(repo, false)
        if ("error" in r) return r.error
        try {
          const pr = await r.client.checks(r.repo, number)
          if (pr.state !== "open") return `#${number} is already ${pr.state}.`
          if (pr.draft) {
            return `#${number} is a draft; it needs marking ready for review before it can merge.`
          }
          return `Showed a merge card for ${r.repo.owner}/${r.repo.name}#${number} (${pr.title}). Nothing merges until someone picks Merge on it; Not now comes back as their next message.`
        } catch (e) {
          return failed(e)
        }
      },
    }),

    read_pr_diff: tool({
      description:
        "Read a pull request’s changed files with each one’s diff. `path` narrows it to one file. Your own Workspace’s changes are in its git; this is for any pull request.",
      inputSchema: z.object({
        number: numberParam,
        path: z.string().optional().describe("One changed file’s path."),
        repo: repoParam,
      }),
      execute: async ({ number, path, repo }) => {
        const r = await resolve(repo, false)
        if ("error" in r) return r.error
        try {
          return formatFiles(await r.client.files(r.repo, number), path)
        } catch (e) {
          return failed(e)
        }
      },
    }),

    read_pr_checks: tool({
      description:
        "Read a pull request’s CI: every check run on its latest commit with its result and summary, and whether it can merge (a conflict shows as dirty).",
      inputSchema: z.object({ number: numberParam, repo: repoParam }),
      execute: async ({ number, repo }) => {
        const r = await resolve(repo, false)
        if ("error" in r) return r.error
        try {
          return formatChecks(number, await r.client.checks(r.repo, number))
        } catch (e) {
          return failed(e)
        }
      },
    }),
  }
  // Each reaches GitHub; none deletes anything, and a close reopens.
  const read = { readOnlyHint: true, openWorldHint: true }
  const write = { destructiveHint: false, openWorldHint: true }
  return annotateTools(tools, {
    search_issues: read,
    read_issue: read,
    create_issue: write,
    comment_on_issue: write,
    update_issue: write,
    link_issues: write,
    list_labels: read,
    review_pr: write,
    // Only offers a card; the merge is the member's own press.
    merge_pr: { readOnlyHint: true, openWorldHint: true },
    read_pr_diff: read,
    read_pr_checks: read,
  })
}

export type GitHubTools = ReturnType<typeof buildGitHubTools>

function summaryLine(i: IssueSummary): string {
  const kind = i.isPullRequest ? "PR" : "issue"
  const labels = i.labels.length ? ` [${i.labels.join(", ")}]` : ""
  return `#${i.number} ${i.title} (${kind}, ${i.state}, by ${i.author}, ${i.comments} comments)${labels} ${i.url}`
}

function formatThread(t: IssueThread): string {
  const kind = t.isPullRequest ? "Pull request" : "Issue"
  const state =
    t.stateReason && t.state === "closed"
      ? `closed as ${t.stateReason.replace(/_/g, " ")}`
      : t.state
  const lines = [
    `# ${t.title}`,
    `${kind} #${t.number}, ${state}, by ${t.author}. ${t.url}`,
  ]
  if (t.labels.length) lines.push(`Labels: ${t.labels.join(", ")}`)
  const rel = t.relations
  const refs = (list: IssueSummary[]) =>
    list.map((i) => `#${i.number} ${i.title} (${i.state})`).join("; ")
  if (rel.parent) lines.push(`Sub-issue of: ${refs([rel.parent])}`)
  if (rel.subIssues.length) lines.push(`Sub-issues: ${refs(rel.subIssues)}`)
  if (rel.blockedBy.length) lines.push(`Blocked by: ${refs(rel.blockedBy)}`)
  if (rel.blocking.length) lines.push(`Blocking: ${refs(rel.blocking)}`)
  lines.push("", t.body.trim() || "(no description)")
  for (const c of t.timeline) {
    const on = c.on ? ` on ${c.on}` : ""
    const id = c.id ? ` [id ${c.id}]` : ""
    lines.push("", `---`, `**${c.author}**${on}, ${c.createdAt}${id}`, "")
    lines.push(c.body.trim() || "(no text)")
  }
  if (t.truncated)
    lines.push("", "(Comments past the first 500 were left out.)")
  return capped(lines.join("\n"))
}

function capped(out: string): string {
  return out.length > MAX_OUTPUT
    ? `${out.slice(0, MAX_OUTPUT)}\n\n(Cut: there is more than this.)`
    : out
}

function formatFiles({ files, more }: PrFiles, only?: string): string {
  const picked = only ? files.filter((f) => f.path === only) : files
  if (only && picked.length === 0) {
    return `${only} isn’t one of its changed files: ${files.map((f) => f.path).join(", ")}.`
  }
  const lines: string[] = []
  if (!only) {
    lines.push(`${files.length} files changed:`)
    for (const f of files) {
      const from = f.previousPath ? ` (from ${f.previousPath})` : ""
      lines.push(
        `- ${f.path}${from}: ${f.status}, +${f.additions} −${f.deletions}`
      )
    }
    if (more) lines.push("(Files past the first 500 were left out.)")
  }
  for (const f of picked) {
    lines.push("", `--- ${f.path}`)
    lines.push(f.patch ?? "(no diff: binary or too large)")
  }
  return capped(lines.join("\n"))
}

function formatChecks(number: number, c: PrChecks): string {
  const lines = [
    `#${number} is ${c.state}, on commit ${c.sha.slice(0, 7)}.${c.mergeableState ? ` Mergeable state: ${c.mergeableState}.` : ""}`,
  ]
  if (c.runs.length === 0) lines.push("No checks ran on this commit.")
  for (const run of c.runs) {
    const result =
      run.status === "completed" ? (run.conclusion ?? "completed") : run.status
    lines.push("", `- ${run.name}: ${result} ${run.url}`)
    // A failing run's own summary says what broke; a passing one's is noise.
    if (
      run.conclusion &&
      !["success", "skipped", "neutral"].includes(run.conclusion)
    ) {
      if (run.title) lines.push(`  ${run.title}`)
      if (run.summary) lines.push(`  ${run.summary.trim().slice(0, 2000)}`)
    }
  }
  return capped(lines.join("\n"))
}
