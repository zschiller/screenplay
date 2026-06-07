import { beforeEach, describe, expect, it, vi } from "vitest"

// The action composes two server-only seams: the current user (auth) and the
// deterministic PR-create path. Stub both so the action's own contract — map
// success to a value, map a throw to a redacted error — is what's under test,
// not the GitHub round-trip or the DB/session stack they'd otherwise drag in.
const { createGitHubPr } = vi.hoisted(() => ({
  createGitHubPr: vi.fn(),
}))

vi.mock("@/lib/auth-helpers", () => ({
  requireUserId: vi.fn(async () => "user-1"),
}))
vi.mock("@/lib/github-pr", () => ({ createGitHubPr }))

import { createPullRequestAction } from "@/lib/create-pr-action"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("createPullRequestAction", () => {
  it("maps a created PR to a success result carrying the URL and number", async () => {
    createGitHubPr.mockResolvedValueOnce({
      url: "https://github.com/acme/widgets/pull/7",
      number: 7,
    })

    const result = await createPullRequestAction("room-1", "sandbox-a")

    expect(result).toEqual({
      success: true,
      value: { url: "https://github.com/acme/widgets/pull/7", number: 7 },
    })
    // No title/body passed — the action delegates server-side generation to
    // createGitHubPr, with no model turn in the loop.
    expect(createGitHubPr).toHaveBeenCalledWith({
      userId: "user-1",
      roomId: "room-1",
      sandboxName: "sandbox-a",
    })
  })

  it("maps a failure to a redacted error, scrubbing any leaked token", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    createGitHubPr.mockRejectedValueOnce(
      new Error(`GitHub API error using token ${token}`)
    )

    const result = await createPullRequestAction("room-1", "sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})
