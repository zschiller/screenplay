import { describe, expect, it } from "vitest"

import { mergeRestoredTabs, terminalTabsFromRecords } from "./restore-tabs"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import type { TerminalTabData } from "@/lib/types"

function tab(id: string, overrides: Partial<TerminalTabData> = {}): TerminalTabData {
  return {
    id,
    branchId: "branch-1",
    terminalSessionId: id,
    label: "Terminal",
    createdAt: 0,
    ...overrides,
  }
}

function row(id: string, overrides: Partial<TerminalTabRecord> = {}): TerminalTabRecord {
  return {
    id,
    userId: "user-1",
    roomId: "room-1",
    branch: "branch-1",
    label: "Terminal",
    harnessKey: null,
    createdAt: 0,
    ...overrides,
  }
}

describe("terminalTabsFromRecords", () => {
  it("maps persisted rows to client-local tab data", () => {
    const tabs = terminalTabsFromRecords([
      row("a", { branch: "branch-9", label: "shell", harnessKey: "claude", createdAt: 42 }),
    ])
    expect(tabs).toEqual([
      {
        id: "a",
        branchId: "branch-9",
        terminalSessionId: "a",
        label: "shell",
        harnessKey: "claude",
        createdAt: 42,
      },
    ])
  })

  it("opens a pre-harness (null harnessKey) row as a plain shell", () => {
    const [t] = terminalTabsFromRecords([row("a", { harnessKey: null })])
    expect(t?.harnessKey).toBeUndefined()
  })
})

describe("mergeRestoredTabs", () => {
  it("places restored tabs first, then local-only tabs", () => {
    const merged = mergeRestoredTabs(
      [tab("restored-1"), tab("restored-2")],
      [tab("restored-1"), tab("local-1")]
    )
    expect(merged.map((t) => t.id)).toEqual(["restored-1", "restored-2", "local-1"])
  })

  it("never drops a tab opened before the re-fetch resolved", () => {
    // `open` carries a tab the server didn't return yet — it must survive.
    const merged = mergeRestoredTabs([tab("restored-1")], [tab("opened-mid-resolve")])
    expect(merged.map((t) => t.id)).toEqual(["restored-1", "opened-mid-resolve"])
  })

  it("dedupes a tab present in both, keeping the restored copy", () => {
    const merged = mergeRestoredTabs(
      [tab("a", { label: "persisted" })],
      [tab("a", { label: "stale-local" })]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.label).toBe("persisted")
  })

  it("returns just the restored set when nothing is open locally", () => {
    const merged = mergeRestoredTabs([tab("a"), tab("b")], [])
    expect(merged.map((t) => t.id)).toEqual(["a", "b"])
  })

  it("returns just the open set when the server has no rows", () => {
    const merged = mergeRestoredTabs([], [tab("local-1"), tab("local-2")])
    expect(merged.map((t) => t.id)).toEqual(["local-1", "local-2"])
  })
})
