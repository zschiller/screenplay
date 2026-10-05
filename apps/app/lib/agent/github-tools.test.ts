import { describe, expect, it, vi } from "vitest"

import { buildGitHubTools } from "@/lib/agent/github-tools"
import { gitHubIssuesClient } from "@/lib/github-issues"
import { baseBranch, baseRepo, makeHarness } from "@/test/canvas/harness"

vi.mock("@/lib/auth-helpers", () => ({
  getGitHubTokenForUser: async () => null,
}))

/**
 * The GitHub tools over a fake GitHub: a fetch that answers by method and
 * path and records every call, behind the real REST client.
 */
type Route = (body: unknown, url: URL) => unknown
function fakeGitHub(routes: Record<string, Route>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname, body })
    const route = routes[`${method} ${url.pathname}`]
    if (!route) {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      })
    }
    return new Response(JSON.stringify(route(body, url)), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

function setup(
  routes: Record<string, Route>,
  opts: {
    sandboxName?: string
    senderless?: boolean
    token?: string | null
    repos?: Array<[string, string, string]>
  } = {}
) {
  const { collections } = makeHarness()
  for (const [id, owner, name] of opts.repos ?? [["repo-1", "acme", "web"]]) {
    collections.repos.set(
      id,
      baseRepo(id, { repoOwner: owner, repoName: name })
    )
  }
  collections.branches.set(
    "b1",
    baseBranch("b1", { repoId: "repo-1", sandboxName: "sp-ws-1" })
  )
  const github = fakeGitHub(routes)
  const tokens: string[] = []
  const tools = buildGitHubTools({
    room: { roomId: "room-1", readDoc: async (fn) => fn(collections) },
    sandboxName: opts.sandboxName,
    userId: "user-1",
    senderless: opts.senderless,
    token: async () => (opts.token === undefined ? "tok" : opts.token),
    client: (token) => {
      tokens.push(token)
      return gitHubIssuesClient(token, github.fetchImpl)
    },
  })
  const run = async (name: keyof typeof tools, input: object) =>
    (await tools[name].execute!(input as never, {
      toolCallId: "t1",
      messages: [],
      context: {},
    })) as string
  return { run, calls: github.calls, tokens }
}

const issue = (overrides: object = {}) => ({
  number: 12,
  html_url: "https://github.com/acme/web/issues/12",
  title: "Sign-in loops",
  state: "open",
  state_reason: null,
  body: "It redirects forever.",
  user: { login: "ada" },
  comments: 1,
  labels: [{ name: "bug" }],
  updated_at: "2026-10-05T10:00:00Z",
  ...overrides,
})

describe("search_issues", () => {
  it("searches the Workspace’s repository for open issues and PRs by default", async () => {
    const { run, calls } = setup(
      { "GET /search/issues": () => ({ items: [issue()] }) },
      { sandboxName: "sp-ws-1" }
    )
    const out = await run("search_issues", { query: "sign-in" })
    expect(out).toBe(
      "#12 Sign-in loops (issue, open, by ada, 1 comments) [bug] https://github.com/acme/web/issues/12"
    )
    expect(calls[0]!.path).toBe("/search/issues")
  })

  it("sends the repository, kind and state in the query", async () => {
    let query = ""
    const { run } = setup({
      "GET /search/issues": (_, url) => {
        query = url.searchParams.get("q") ?? ""
        return { items: [] }
      },
    })
    expect(
      await run("search_issues", { kind: "pr", state: "closed", query: "x" })
    ).toBe("Nothing matched.")
    expect(query).toBe("repo:acme/web is:pr is:closed x")
  })
})

describe("repository", () => {
  const repos: Array<[string, string, string]> = [
    ["repo-1", "acme", "web"],
    ["repo-2", "acme", "api"],
  ]

  it("asks for one when the canvas has several and the chat has none", async () => {
    const { run, calls } = setup({}, { repos })
    expect(await run("read_issue", { number: 1 })).toBe(
      "Name the repository: this canvas has acme/web, acme/api."
    )
    expect(calls).toEqual([])
  })

  it("takes another of the canvas’s repositories by name, any case", async () => {
    const { run, calls } = setup(
      { "GET /search/issues": () => ({ items: [] }) },
      { repos, sandboxName: "sp-ws-1" }
    )
    await run("search_issues", { repo: "ACME/api" })
    expect(calls).toHaveLength(1)
    const { run: run2 } = setup({}, { repos })
    expect(await run2("read_issue", { number: 1, repo: "other/repo" })).toBe(
      "other/repo isn’t one of this canvas’s repositories: acme/web, acme/api."
    )
  })

  it("says so when the member hasn’t connected GitHub", async () => {
    const { run } = setup({}, { token: null })
    expect(await run("read_issue", { number: 1 })).toMatch(
      /hasn’t connected a GitHub account/
    )
  })
})

describe("read_issue", () => {
  it("reads a pull request with its comments, reviews and review comments, oldest first", async () => {
    const { run } = setup({
      "GET /repos/acme/web/issues/7": () =>
        issue({
          number: 7,
          title: "Fix sign-in",
          html_url: "https://github.com/acme/web/pull/7",
          pull_request: { merged_at: null },
          labels: [],
        }),
      "GET /repos/acme/web/issues/7/comments": () => [
        {
          id: 1,
          user: { login: "ada" },
          created_at: "2026-10-05T10:03:00Z",
          body: "Looks close.",
        },
      ],
      "GET /repos/acme/web/pulls/7/reviews": () => [
        {
          id: 2,
          user: { login: "lin" },
          submitted_at: "2026-10-05T10:01:00Z",
          body: "Two things.",
          state: "CHANGES_REQUESTED",
        },
        // A review that only holds its line comments is left out.
        {
          id: 3,
          user: { login: "lin" },
          submitted_at: "2026-10-05T10:01:00Z",
          body: "",
          state: "COMMENTED",
        },
      ],
      "GET /repos/acme/web/pulls/7/comments": () => [
        {
          id: 99,
          user: { login: "lin" },
          created_at: "2026-10-05T10:02:00Z",
          body: "Rename this.",
          path: "src/auth.ts",
          line: 40,
        },
      ],
    })
    expect(await run("read_issue", { number: 7 })).toBe(
      [
        "# Fix sign-in",
        "Pull request #7, open, by ada. https://github.com/acme/web/pull/7",
        "",
        "It redirects forever.",
        "",
        "---",
        "**lin** on review: changes requested, 2026-10-05T10:01:00Z",
        "",
        "Two things.",
        "",
        "---",
        "**lin** on src/auth.ts:40, 2026-10-05T10:02:00Z [id 99]",
        "",
        "Rename this.",
        "",
        "---",
        "**ada**, 2026-10-05T10:03:00Z",
        "",
        "Looks close.",
      ].join("\n")
    )
  })

  it("reports GitHub’s error", async () => {
    const { run } = setup({})
    expect(await run("read_issue", { number: 404 })).toBe(
      "GitHub said: Not Found (404)"
    )
  })
})

describe("writes", () => {
  it("creates an issue", async () => {
    const { run, calls } = setup({
      "POST /repos/acme/web/issues": () =>
        issue({
          number: 13,
          html_url: "https://github.com/acme/web/issues/13",
        }),
    })
    expect(
      await run("create_issue", { title: "Flaky test", labels: ["bug"] })
    ).toBe("Created issue #13: https://github.com/acme/web/issues/13")
    expect(calls[0]!.body).toEqual({
      title: "Flaky test",
      body: "",
      labels: ["bug"],
    })
  })

  it("comments, or replies to a review comment in its thread", async () => {
    const { run, calls } = setup({
      "POST /repos/acme/web/issues/7/comments": () => ({
        html_url: "https://github.com/acme/web/pull/7#issuecomment-5",
      }),
      "POST /repos/acme/web/pulls/7/comments/99/replies": () => ({
        html_url: "https://github.com/acme/web/pull/7#discussion_r6",
      }),
    })
    expect(await run("comment_on_issue", { number: 7, body: "Done." })).toBe(
      "Commented on #7: https://github.com/acme/web/pull/7#issuecomment-5"
    )
    await run("comment_on_issue", { number: 7, body: "Renamed.", replyTo: 99 })
    expect(calls.map((c) => c.path)).toEqual([
      "/repos/acme/web/issues/7/comments",
      "/repos/acme/web/pulls/7/comments/99/replies",
    ])
    expect(calls[1]!.body).toEqual({ body: "Renamed." })
  })

  it("closes an issue as not planned", async () => {
    const { run, calls } = setup({
      "PATCH /repos/acme/web/issues/12": () =>
        issue({ state: "closed", state_reason: "not_planned" }),
    })
    expect(
      await run("update_issue", {
        number: 12,
        state: "closed",
        reason: "not_planned",
      })
    ).toBe("Closed #12 (now closed): https://github.com/acme/web/issues/12")
    expect(calls[0]!.body).toEqual({
      state: "closed",
      state_reason: "not_planned",
    })
  })

  it("refuses on a turn nobody sent, before reaching GitHub", async () => {
    const { run, calls, tokens } = setup({}, { senderless: true })
    for (const [name, input] of [
      ["create_issue", { title: "x" }],
      ["comment_on_issue", { number: 1, body: "x" }],
      ["update_issue", { number: 1, state: "closed" }],
    ] as const) {
      expect(await run(name, input)).toMatch(/nobody sent this turn/)
    }
    expect(calls).toEqual([])
    expect(tokens).toEqual([])
  })
})
