import { describe, expect, it } from "vitest"

import { partitionTerminalsByBranch } from "./orphan-tabs"
import type { TerminalTabData } from "@/lib/types"

function tab(id: string, branchId: string): TerminalTabData {
  return {
    id,
    branchId,
    terminalSessionId: id,
    label: "Terminal",
    createdAt: 0,
  }
}

describe("partitionTerminalsByBranch", () => {
  it("keeps tabs whose branch still exists and orphans the rest", () => {
    const tabs = [tab("a", "branch-1"), tab("b", "gone"), tab("c", "branch-2")]
    const { kept, orphaned } = partitionTerminalsByBranch(
      tabs,
      new Set(["branch-1", "branch-2"]),
    )
    expect(kept.map((t) => t.id)).toEqual(["a", "c"])
    expect(orphaned.map((t) => t.id)).toEqual(["b"])
  })

  it("orphans every tab when no branches exist (last branch deleted)", () => {
    const tabs = [tab("a", "branch-1"), tab("b", "branch-1")]
    const { kept, orphaned } = partitionTerminalsByBranch(tabs, new Set())
    expect(kept).toEqual([])
    expect(orphaned.map((t) => t.id)).toEqual(["a", "b"])
  })

  it("orphans nothing when every tab's branch is live", () => {
    const tabs = [tab("a", "branch-1")]
    const { kept, orphaned } = partitionTerminalsByBranch(
      tabs,
      new Set(["branch-1"]),
    )
    expect(kept.map((t) => t.id)).toEqual(["a"])
    expect(orphaned).toEqual([])
  })

  it("preserves order within each partition", () => {
    const tabs = [
      tab("a", "live"),
      tab("b", "dead"),
      tab("c", "live"),
      tab("d", "dead"),
    ]
    const { kept, orphaned } = partitionTerminalsByBranch(
      tabs,
      new Set(["live"]),
    )
    expect(kept.map((t) => t.id)).toEqual(["a", "c"])
    expect(orphaned.map((t) => t.id)).toEqual(["b", "d"])
  })
})
