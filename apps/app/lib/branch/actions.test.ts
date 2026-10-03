import { describe, expect, it } from "vitest"

import { routeBranchAction, type BranchActionInput } from "@/lib/branch/actions"

const agent = { sandboxName: "sb-1" }
const input: BranchActionInput = { agent }

describe("routeBranchAction", () => {
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
      agent: { sandboxName: "" },
    }
    for (const kind of [
      "create-pr",
      "restart-dev-server",
      "restart-sandbox",
      "recreate",
    ] as const) {
      expect(routeBranchAction(kind, gone)).toEqual({ kind: "none" })
    }
  })

  it("yields no route for a missing agent", () => {
    expect(routeBranchAction("create-pr", { agent: undefined })).toEqual({
      kind: "none",
    })
  })
})
