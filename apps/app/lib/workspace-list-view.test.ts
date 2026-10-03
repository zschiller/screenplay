import { describe, expect, it } from "vitest"
import {
  roomWorkspaceFacts,
  workspaceState,
} from "@/lib/branch/workspace-state"
import type { BranchData } from "@/lib/types"
import { groupWorkspaces, sortWorkspaces } from "@/lib/workspace-list-view"

function ws(id: string, patch: Partial<BranchData> = {}): BranchData {
  return {
    id,
    ref: id,
    status: "running",
    createdAt: 0,
    ...patch,
  } as BranchData
}

describe("sortWorkspaces", () => {
  it("orders by the last turn, newest first, falling back to creation", () => {
    const list = [
      ws("b", { title: "beta", createdAt: 1, lastActivityAt: 10 }),
      ws("a", { title: "Alpha", createdAt: 2 }),
      ws("c", { title: "gamma 10", createdAt: 30 }),
      ws("d", { title: "gamma 9", createdAt: 3, lastActivityAt: 20 }),
    ]
    expect(sortWorkspaces(list).map((b) => b.id)).toEqual(["c", "d", "b", "a"])
  })
})

describe("groupWorkspaces", () => {
  it("returns non-empty sections in order, each most recent first", () => {
    const list = [
      ws("z", { createdAt: 1 }),
      ws("f", { status: "error" }),
      ws("w"),
      ws("a", { createdAt: 2 }),
    ]
    const room = roomWorkspaceFacts([{ branchId: "w", isStreaming: true }], [])
    const groups = groupWorkspaces(list, (b) => workspaceState(b, room).section)
    expect(groups.map((g) => [g.section, g.branches.map((b) => b.id)])).toEqual(
      [
        ["working", ["w"]],
        ["needs-you", ["f"]],
        ["idle", ["a", "z"]],
      ]
    )
  })
})
