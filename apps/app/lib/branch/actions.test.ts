import { describe, expect, it } from "vitest"

import {
  routeBranchAction,
  type BranchActionInput,
} from "@/lib/branch/actions"

const agent = { sandboxName: "sb-1", ref: "feature-x" }
const repo = { defaultBranch: "main" }
const input: BranchActionInput = { agent, repo }

describe("routeBranchAction", () => {
  it("routes rebase to the engine with the rebase prompt", () => {
    const route = routeBranchAction("rebase", input)
    expect(route.kind).toBe("engine")
    expect(route.kind === "engine" && route.prompt).toContain("origin/main")
    expect(route.kind === "engine" && route.prompt).toContain(
      "walk me through them"
    )
  })

  it("routes create-pr to the deterministic action", () => {
    expect(routeBranchAction("create-pr", input)).toEqual({
      kind: "action",
      action: "create-pr",
    })
  })

  it("routes the restart family to the matching recovery runner", () => {
    expect(routeBranchAction("restart-dev-server", input)).toEqual({
      kind: "recovery",
      recovery: "dev-server",
    })
    expect(routeBranchAction("restart-sandbox", input)).toEqual({
      kind: "recovery",
      recovery: "sandbox",
    })
    expect(routeBranchAction("recreate", input)).toEqual({
      kind: "recovery",
      recovery: "recreate",
    })
  })

  it("yields no route for any action when the Sandbox is gone", () => {
    const gone: BranchActionInput = {
      agent: { sandboxName: "", ref: "feature-x" },
      repo,
    }
    for (const kind of [
      "rebase",
      "create-pr",
      "restart-dev-server",
      "restart-sandbox",
      "recreate",
    ] as const) {
      expect(routeBranchAction(kind, gone)).toEqual({ kind: "none" })
    }
  })

  it("yields no route for a missing agent", () => {
    expect(
      routeBranchAction("create-pr", { agent: undefined, repo })
    ).toEqual({ kind: "none" })
  })

  it("does not rebase without a branch ref", () => {
    expect(
      routeBranchAction("rebase", {
        agent: { sandboxName: "sb-1", ref: "" },
        repo,
      })
    ).toEqual({ kind: "none" })
  })

  it("does not rebase without the repo", () => {
    expect(
      routeBranchAction("rebase", { agent, repo: undefined })
    ).toEqual({ kind: "none" })
  })
})
