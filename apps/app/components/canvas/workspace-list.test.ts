import { describe, expect, it } from "vitest"
import type { BranchData } from "@/lib/types"
import { pickableWorkspaces } from "./workspace-list"

function branch(id: string, patch: Partial<BranchData> = {}): BranchData {
  return {
    id,
    ref: `claude/${id}`,
    status: "running",
    ...patch,
  } as BranchData
}

describe("pickableWorkspaces", () => {
  it("keeps running and busy Workspaces", () => {
    const branches = [
      branch("running"),
      branch("starting", { status: "starting" }),
      branch("creating", { status: "creating" }),
    ]
    expect(pickableWorkspaces(branches).map((b) => b.id)).toEqual([
      "running",
      "starting",
      "creating",
    ])
  })

  it("leaves out failed, stopped and unnamed Workspaces", () => {
    const branches = [
      branch("error", { status: "error" }),
      branch("stopped", { status: "stopped" }),
      branch("no-ref", { ref: "" }),
    ]
    expect(pickableWorkspaces(branches)).toEqual([])
  })

  it("leaves out a Done Workspace even when it is still running", () => {
    const branches = [branch("done", { doneAt: 1 }), branch("open")]
    expect(pickableWorkspaces(branches).map((b) => b.id)).toEqual(["open"])
  })
})
