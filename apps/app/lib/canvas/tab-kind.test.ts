import { describe, expect, it } from "vitest"

import { createTerminalTab, TERMINAL_TAB_LABEL } from "@/lib/canvas/tab-kind"

describe("createTerminalTab", () => {
  it("produces a terminal tab bound to the agent's sandbox", () => {
    const tab = createTerminalTab({
      id: "t1",
      branchId: "agent-1",
      createdAt: 5,
    })

    expect(tab.branchId).toBe("agent-1")
    expect(tab.createdAt).toBe(5)
    // The shared live-view identity collaborators co-view against is the tab's
    // own id, so opening the same tab on a second client co-views one PTY.
    expect(tab.terminalSessionId).toBe("t1")
  })

  it("opens a plain shell, launching no harness", () => {
    const tab = createTerminalTab({
      id: "t1",
      branchId: "agent-1",
      createdAt: 0,
    })

    expect(tab.harnessKey).toBeUndefined()
  })

  it("keeps a restored row's harness so that tab still runs it", () => {
    const tab = createTerminalTab({
      id: "t1",
      branchId: "agent-1",
      createdAt: 0,
      harnessKey: "claude-code",
    })

    expect(tab.harnessKey).toBe("claude-code")
  })

  it("defaults to the terminal label", () => {
    const tab = createTerminalTab({
      id: "t1",
      branchId: "agent-1",
      createdAt: 0,
    })

    expect(tab.label).toBe(TERMINAL_TAB_LABEL)
  })

  it("accepts a custom label", () => {
    const tab = createTerminalTab({
      id: "t1",
      branchId: "agent-1",
      createdAt: 0,
      label: "shell",
    })

    expect(tab.label).toBe("shell")
  })
})
