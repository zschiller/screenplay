import { afterEach, describe, expect, it, vi } from "vitest"
import { AGENT_POST_MARK } from "@/lib/agent-post-mark"
import { githubPrReader } from "./github"
import type { PrTarget } from "./watch"

/**
 * PR Watch's GitHub reader reading reviews (#1704), over a stubbed `fetch`
 * that answers by path.
 */

const API = "https://api.github.com/repos/o/r"
const T0 = "2026-10-05T10:00:00Z"
const target: PrTarget = {
  branchId: "b1",
  owner: "o",
  repo: "r",
  branch: "feat",
}

type Answer = { body: unknown; link?: string }

function stubGitHub(answers: Record<string, Answer>) {
  const asked: string[] = []
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.slice(API.length)
    asked.push(path)
    const answer = answers[path]
    if (!answer) return new Response("{}", { status: 404 })
    return new Response(JSON.stringify(answer.body), {
      headers: answer.link ? { link: answer.link } : {},
    })
  })
  return asked
}

const pulls = {
  body: [
    {
      number: 7,
      html_url: "https://github.com/o/r/pull/7",
      state: "open",
      merged_at: null,
      created_at: "2026-10-05T09:00:00Z",
      head: { sha: "abc" },
    },
  ],
}
const PULLS =
  "/pulls?head=o:feat&state=all&per_page=10&sort=created&direction=desc"
const REVIEWS = "/pulls/7/reviews?per_page=100"

const raw = (id: number, more: Record<string, unknown>) => ({
  id,
  user: { login: "ada" },
  body: "",
  state: "COMMENTED",
  submitted_at: "2026-10-05T10:05:00Z",
  html_url: `https://github.com/o/r/pull/7#pullrequestreview-${id}`,
  ...more,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("githubPrReader reviews (#1704)", () => {
  it("baselines a PR seen for the first time without reading any review", async () => {
    const asked = stubGitHub({
      [PULLS]: pulls,
      [REVIEWS]: {
        body: [raw(1, { state: "APPROVED", submitted_at: T0 })],
      },
    })
    const pr = await githubPrReader(async () => "t")(target)
    expect(pr?.reviews).toEqual({ latestAt: T0, fresh: [] })
    expect(asked.some((p) => p.includes("/reviews/"))).toBe(false)
  })

  it("starts from the PR's creation when it has no reviews", async () => {
    stubGitHub({ [PULLS]: pulls, [REVIEWS]: { body: [] } })
    const pr = await githubPrReader(async () => "t")(target)
    expect(pr?.reviews).toEqual({ latestAt: "2026-10-05T09:00:00Z", fresh: [] })
  })

  it("reads reviews after the last seen one, on the last page, with their comments", async () => {
    stubGitHub({
      [PULLS]: pulls,
      [REVIEWS]: {
        body: [],
        link: `<${API}${REVIEWS}&page=2>; rel="next", <${API}${REVIEWS}&page=2>; rel="last"`,
      },
      [`${REVIEWS}&page=2`]: {
        body: [
          raw(1, { submitted_at: T0, state: "APPROVED" }),
          raw(2, { state: "CHANGES_REQUESTED", body: "Two things." }),
          // A draft only its author sees isn't news.
          raw(3, { state: "PENDING", submitted_at: null }),
          // The agent's reply in a thread: a review holding only its comment.
          raw(4, { user: { login: "zack" } }),
          raw(5, { state: "APPROVED", body: AGENT_POST_MARK }),
        ],
      },
      "/pulls/7/reviews/2/comments?per_page=100": {
        body: [{ body: "Rename this." }, { body: "And this." }],
      },
      "/pulls/7/reviews/4/comments?per_page=100": {
        body: [{ body: `Renamed.\n\n${AGENT_POST_MARK}` }],
      },
      "/pulls/7/reviews/5/comments?per_page=100": { body: [] },
    })
    const pr = await githubPrReader(async () => "t")({
      ...target,
      reviewsSince: { number: 7, at: T0 },
    })
    expect(pr?.reviews?.latestAt).toBe("2026-10-05T10:05:00Z")
    expect(pr?.reviews?.fresh).toEqual([
      {
        author: "ada",
        verdict: "changes_requested",
        comments: 2,
        submittedAt: "2026-10-05T10:05:00Z",
        url: "https://github.com/o/r/pull/7#pullrequestreview-2",
      },
      expect.objectContaining({ author: "zack", byAgent: true }),
      expect.objectContaining({ verdict: "approved", byAgent: true }),
    ])
  })

  it("reports no reviews when a new one's comments can't be read", async () => {
    stubGitHub({
      [PULLS]: pulls,
      [REVIEWS]: { body: [raw(2, {})] },
    })
    const pr = await githubPrReader(async () => "t")({
      ...target,
      reviewsSince: { number: 7, at: T0 },
    })
    expect(pr?.state).toBe("open")
    expect(pr?.reviews).toBeUndefined()
  })
})
