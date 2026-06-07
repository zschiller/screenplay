import { describe, expect, it, vi } from "vitest"

// github-pr imports the auth/token lookup and the Y.Doc reader, both of which
// reach for server-only env (DATABASE_URL / LIVEBLOCKS_SECRET_KEY) at import.
// buildPrContent touches neither, so stub them to keep the import graph
// unit-testable under plain Node.
vi.mock("@/lib/auth-helpers", () => ({ getGitHubTokenForUser: vi.fn() }))
vi.mock("@/lib/yjs/server", () => ({ readRoomDoc: vi.fn() }))

import { buildPrContent } from "@/lib/github-pr"

const commit = (message: string) => ({ commit: { message } })

describe("buildPrContent", () => {
  it("falls back to the branch name with an empty body when there are no commits", () => {
    expect(buildPrContent([], "feature/foo")).toEqual({
      title: "feature/foo",
      body: "",
    })
  })

  it("uses a single commit's subject as the title and its message body as the PR body", () => {
    expect(
      buildPrContent(
        [commit("Add the thing\n\nWhy the thing matters\nand a second line")],
        "feature/foo"
      )
    ).toEqual({
      title: "Add the thing",
      body: "Why the thing matters\nand a second line",
    })
  })

  it("leaves the body empty for a subject-only single commit", () => {
    expect(buildPrContent([commit("Just a subject")], "feature/foo")).toEqual({
      title: "Just a subject",
      body: "",
    })
  })

  it("titles from the first commit and lists every subject as the body for many commits", () => {
    expect(
      buildPrContent(
        [
          commit("First change\n\nbody ignored"),
          commit("Second change"),
          commit("Third change\n\nalso ignored"),
        ],
        "feature/foo"
      )
    ).toEqual({
      title: "First change",
      body: "- First change\n- Second change\n- Third change",
    })
  })
})
