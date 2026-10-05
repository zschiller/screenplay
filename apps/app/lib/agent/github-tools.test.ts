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

describe("native links", () => {
  it("reads an issue’s blocking edges, parent and sub-issues", async () => {
    const { run } = setup({
      "GET /repos/acme/web/issues/12": () =>
        issue({
          comments: 0,
          issue_dependencies_summary: {
            total_blocked_by: 1,
            total_blocking: 0,
          },
          sub_issues_summary: { total: 1 },
          parent_issue_url: "https://api.github.com/repos/acme/web/issues/10",
        }),
      "GET /repos/acme/web/issues/12/comments": () => [],
      "GET /repos/acme/web/issues/12/dependencies/blocked_by": () => [
        issue({ number: 11, title: "Session store" }),
      ],
      "GET /repos/acme/web/issues/12/sub_issues": () => [
        issue({ number: 14, title: "Redirect test", state: "closed" }),
      ],
      "GET /repos/acme/web/issues/12/parent": () =>
        issue({ number: 10, title: "Auth spec" }),
    })
    const out = await run("read_issue", { number: 12 })
    expect(out).toContain("Sub-issue of: #10 Auth spec (open)")
    expect(out).toContain("Sub-issues: #14 Redirect test (closed)")
    expect(out).toContain("Blocked by: #11 Session store (open)")
    expect(out).not.toContain("Blocking:")
  })

  it("adds a blocking edge on the blocked issue, by the blocker’s id", async () => {
    const { run, calls } = setup({
      "GET /repos/acme/web/issues/11": () => issue({ number: 11, id: 5011 }),
      "POST /repos/acme/web/issues/12/dependencies/blocked_by": () => ({}),
    })
    expect(
      await run("link_issues", { number: 11, relation: "blocks", other: 12 })
    ).toBe("Linked #11 blocking #12.")
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/repos/acme/web/issues/12/dependencies/blocked_by",
      body: { issue_id: 5011 },
    })
  })

  it("adds and removes a sub-issue on its parent", async () => {
    const { run, calls } = setup({
      "GET /repos/acme/web/issues/14": () => issue({ number: 14, id: 5014 }),
      "POST /repos/acme/web/issues/10/sub_issues": () => ({}),
      "DELETE /repos/acme/web/issues/10/sub_issue": () => ({}),
    })
    await run("link_issues", { number: 10, relation: "parent_of", other: 14 })
    expect(
      await run("link_issues", {
        number: 14,
        relation: "child_of",
        other: 10,
        remove: true,
      })
    ).toBe("Removed #14 as a sub-issue of #10.")
    expect(calls.filter((c) => c.method !== "GET")).toEqual([
      {
        method: "POST",
        path: "/repos/acme/web/issues/10/sub_issues",
        body: { sub_issue_id: 5014 },
      },
      {
        method: "DELETE",
        path: "/repos/acme/web/issues/10/sub_issue",
        body: { sub_issue_id: 5014 },
      },
    ])
  })

  it("refuses to link on a turn nobody sent", async () => {
    const { run, calls } = setup({}, { senderless: true })
    expect(
      await run("link_issues", { number: 1, relation: "blocks", other: 2 })
    ).toMatch(/nobody sent this turn/)
    expect(calls).toEqual([])
  })

  it("lists labels", async () => {
    const { run } = setup({
      "GET /repos/acme/web/labels": () => [
        { name: "bug", description: "Something is broken" },
        { name: "ready-for-agent", description: null },
      ],
    })
    expect(await run("list_labels", {})).toBe(
      "bug: Something is broken\nready-for-agent"
    )
  })
})

describe("pull request diff and checks", () => {
  const files = () => [
    {
      filename: "src/auth.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: "@@ -1 +1,2 @@\n-a\n+b\n+c",
    },
    {
      filename: "logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
    },
  ]

  it("reads every changed file with its diff", async () => {
    const { run } = setup({ "GET /repos/acme/web/pulls/7/files": files })
    expect(await run("read_pr_diff", { number: 7 })).toBe(
      [
        "2 files changed:",
        "- src/auth.ts: modified, +2 −1",
        "- logo.png: added, +0 −0",
        "",
        "--- src/auth.ts",
        "@@ -1 +1,2 @@\n-a\n+b\n+c",
        "",
        "--- logo.png",
        "(no diff: binary or too large)",
      ].join("\n")
    )
  })

  it("narrows to one file, and names the files when it isn’t one", async () => {
    const { run } = setup({ "GET /repos/acme/web/pulls/7/files": files })
    expect(await run("read_pr_diff", { number: 7, path: "src/auth.ts" })).toBe(
      "\n--- src/auth.ts\n@@ -1 +1,2 @@\n-a\n+b\n+c"
    )
    expect(await run("read_pr_diff", { number: 7, path: "x.ts" })).toBe(
      "x.ts isn’t one of its changed files: src/auth.ts, logo.png."
    )
  })

  it("reads the head commit’s checks, with a failing one’s summary", async () => {
    const { run } = setup({
      "GET /repos/acme/web/pulls/7": () => ({
        state: "open",
        merged: false,
        mergeable_state: "blocked",
        head: { sha: "abcdef1234" },
      }),
      "GET /repos/acme/web/commits/abcdef1234/check-runs": () => ({
        check_runs: [
          {
            name: "typecheck",
            status: "completed",
            conclusion: "success",
            html_url: "https://ci/1",
            output: { title: "ok", summary: "all good" },
          },
          {
            name: "unit (1)",
            status: "completed",
            conclusion: "failure",
            html_url: "https://ci/2",
            output: { title: "1 failed", summary: "auth.test.ts: expected 1" },
          },
          {
            name: "browser",
            status: "in_progress",
            conclusion: null,
            html_url: "https://ci/3",
          },
        ],
      }),
    })
    expect(await run("read_pr_checks", { number: 7 })).toBe(
      [
        "#7 is open, on commit abcdef1. Mergeable state: blocked.",
        "",
        "- typecheck: success https://ci/1",
        "",
        "- unit (1): failure https://ci/2",
        "  1 failed",
        "  auth.test.ts: expected 1",
        "",
        "- browser: in_progress https://ci/3",
      ].join("\n")
    )
  })
})

describe("reviews and merges", () => {
  it("submits a review with line comments on the new side", async () => {
    const { run, calls } = setup({
      "POST /repos/acme/web/pulls/7/reviews": () => ({
        html_url: "https://github.com/acme/web/pull/7#pullrequestreview-1",
      }),
    })
    expect(
      await run("review_pr", {
        number: 7,
        event: "request_changes",
        body: "One thing.",
        comments: [{ path: "src/auth.ts", line: 40, body: "Rename this." }],
      })
    ).toBe(
      "Requested changes on #7: https://github.com/acme/web/pull/7#pullrequestreview-1"
    )
    expect(calls[0]!.body).toEqual({
      event: "REQUEST_CHANGES",
      body: "One thing.",
      comments: [
        { path: "src/auth.ts", line: 40, side: "RIGHT", body: "Rename this." },
      ],
    })
  })

  it("refuses to review on a turn nobody sent", async () => {
    const { run, calls } = setup({}, { senderless: true })
    expect(await run("review_pr", { number: 7, event: "approve" })).toMatch(
      /nobody sent this turn/
    )
    expect(calls).toEqual([])
  })

  const openPr = (overrides: object = {}) => ({
    "GET /repos/acme/web/pulls/7": () => ({
      title: "Fix sign-in",
      html_url: "https://github.com/acme/web/pull/7",
      draft: false,
      state: "open",
      merged: false,
      mergeable_state: "clean",
      head: { sha: "abc123" },
      ...overrides,
    }),
    "GET /repos/acme/web/commits/abc123/check-runs": () => ({
      check_runs: [],
    }),
  })

  it("offers a merge card and merges nothing itself", async () => {
    const { run, calls } = setup(openPr())
    expect(await run("merge_pr", { number: 7 })).toBe(
      "Showed a merge card for acme/web#7 (Fix sign-in). Nothing merges until someone presses Merge on it."
    )
    expect(calls.every((c) => c.method === "GET")).toBe(true)
  })

  it("says so for a merged or draft PR instead of a card", async () => {
    const merged = setup(openPr({ state: "closed", merged: true }))
    expect(await merged.run("merge_pr", { number: 7 })).toBe(
      "#7 is already merged."
    )
    const draft = setup(openPr({ draft: true }))
    expect(await draft.run("merge_pr", { number: 7 })).toMatch(/is a draft/)
  })
})
