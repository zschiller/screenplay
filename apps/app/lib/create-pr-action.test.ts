import { beforeEach, describe, expect, it, vi } from "vitest"

// The action composes two server-only seams: Room Access (the session's
// membership) and the deterministic PR-create path. Stub both so the action's own contract — map
// success to a value, map a throw to a redacted error — is what's under test,
// not the GitHub round-trip or the DB/session stack they'd otherwise drag in.
const { createGitHubPr, openRoom, room } = vi.hoisted(() => {
  const room = { roomId: "room-1", userId: "user-1", role: "editor" }
  return { createGitHubPr: vi.fn(), openRoom: vi.fn(async () => room), room }
})

vi.mock("@/lib/room-access", () => ({ openRoom }))
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
    expect(openRoom).toHaveBeenCalledWith("room-1")
    expect(createGitHubPr).toHaveBeenCalledWith({
      userId: "user-1",
      room,
      sandboxName: "sandbox-a",
    })
  })

  it("refuses a non-member before touching GitHub", async () => {
    openRoom.mockRejectedValueOnce(
      new Error("You don't have access to this project")
    )

    const result = await createPullRequestAction("room-1", "sandbox-a")

    expect(result).toEqual({
      success: false,
      error: "You don't have access to this project",
    })
    expect(createGitHubPr).not.toHaveBeenCalled()
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
