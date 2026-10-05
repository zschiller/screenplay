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
} from "@/lib/github-issues"
import { annotateTools } from "@/lib/mcp/tool-server"
import type { RoomReader } from "@/lib/room-access"

/**
 * A chat's GitHub tools: search and read issues and pull requests with their
 * comments, open issues, comment, and close or reopen. Workspace chats and
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

type CanvasRepo = GitHubRepoRef & { id: string }

/** A read's longest output; the rest of a long thread is cut. */
const MAX_OUTPUT = 60_000

const repoParam = z
  .string()
  .optional()
  .describe(
    "The repository as owner/name. Defaults to this Workspace’s repository, or the canvas’s only one."
  )

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
    const { repos, own } = await ctx.room.readDoc(({ repos, branches }) => {
      const list: CanvasRepo[] = repos
        .toArray()
        .filter((r) => r.repoOwner && r.repoName)
        .map((r) => ({ id: r.id, owner: r.repoOwner, name: r.repoName }))
      const branch = ctx.sandboxName
        ? branches.toArray().find((b) => b.sandboxName === ctx.sandboxName)
        : undefined
      return { repos: list, own: branch?.repoId }
    })
    const names = repos.map((r) => `${r.owner}/${r.name}`).join(", ")
    let picked: CanvasRepo | undefined
    if (repo) {
      const want = repo.trim().toLowerCase()
      picked = repos.find((r) => `${r.owner}/${r.name}`.toLowerCase() === want)
      if (!picked) {
        return {
          error: repos.length
            ? `${repo} isn’t one of this canvas’s repositories: ${names}.`
            : "This canvas has no GitHub repositories.",
        }
      }
    } else {
      picked =
        repos.find((r) => r.id === own) ??
        (repos.length === 1 ? repos[0] : undefined)
      if (!picked) {
        return {
          error: repos.length
            ? `Name the repository: this canvas has ${names}.`
            : "This canvas has no GitHub repositories.",
        }
      }
    }
    const token = await tokenFor(ctx.userId)
    if (!token) {
      return {
        error:
          "Nothing reached GitHub: the member this turn runs for hasn’t connected a GitHub account.",
      }
    }
    return {
      repo: { owner: picked.owner, name: picked.name },
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
  lines.push("", t.body.trim() || "(no description)")
  for (const c of t.timeline) {
    const on = c.on ? ` on ${c.on}` : ""
    const id = c.id ? ` [id ${c.id}]` : ""
    lines.push("", `---`, `**${c.author}**${on}, ${c.createdAt}${id}`, "")
    lines.push(c.body.trim() || "(no text)")
  }
  if (t.truncated)
    lines.push("", "(Comments past the first 500 were left out.)")
  const out = lines.join("\n")
  return out.length > MAX_OUTPUT
    ? `${out.slice(0, MAX_OUTPUT)}\n\n(Cut: the thread is longer than this.)`
    : out
}
