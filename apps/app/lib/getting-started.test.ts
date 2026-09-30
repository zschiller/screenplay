import { describe, expect, it } from "vitest"

import { gettingStartedProgress } from "./getting-started"

const repo = { id: "repo-1" }
const branch = (
  id: string,
  overrides: { lastActivityAt?: number; pendingSeed?: boolean } = {}
) => ({
  id,
  status: "running" as const,
  statusMessage: undefined,
  lastActivityAt: overrides.lastActivityAt,
  pendingSeed: overrides.pendingSeed
    ? {
        chatId: "c1",
        message: "Make the header sticky",
        coordinatorChatId: "r",
      }
    : undefined,
})

describe("gettingStartedProgress", () => {
  it("starts on Add a repository", () => {
    const p = gettingStartedProgress({
      repos: [],
      branches: [],
      workspaceOpened: false,
    })
    expect(p).toEqual({
      project: false,
      ask: false,
      open: false,
      current: "project",
      branch: null,
    })
  })

  it("moves to Ask the Coordinator once a repository is added", () => {
    // Adding a repository starts a fresh Workspace; it isn't an ask yet.
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1")],
      workspaceOpened: false,
    })
    expect(p.current).toBe("ask")
    expect(p.branch).toBeNull()
  })

  it("counts an ask queued for a Workspace that is still starting", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1", { pendingSeed: true })],
      workspaceOpened: false,
    })
    expect(p).toMatchObject({ ask: true, current: "open" })
    expect(p.branch?.id).toBe("b1")
  })

  it("follows the Workspace the first ask went to", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1"), branch("b2", { lastActivityAt: 1 })],
      workspaceOpened: false,
    })
    expect(p.branch?.id).toBe("b2")
    expect(p.current).toBe("open")
  })

  it("is done once a Workspace has been opened", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1", { lastActivityAt: 1 })],
      workspaceOpened: true,
    })
    expect(p.open).toBe(true)
    expect(p.current).toBeNull()
  })
})
