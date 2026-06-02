import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createTerminalTab,
  readLastHarnessKey,
  readLastTabKind,
  TERMINAL_TAB_LABEL,
  writeLastHarnessKey,
  writeLastTabKind,
} from "@/lib/canvas/tab-kind"

/** Install a minimal in-memory localStorage on globalThis.window for one test. */
function stubWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  }
}

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

describe("default tab kind pref", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it("defaults to chat with no window (SSR) and no stored value", () => {
    delete (globalThis as { window?: unknown }).window
    expect(readLastTabKind()).toBe("chat")

    stubWindow()
    expect(readLastTabKind()).toBe("chat")
  })

  it('reads only an exact "terminal" as terminal', () => {
    stubWindow({ "agent-last-tab-kind": "terminal" })
    expect(readLastTabKind()).toBe("terminal")

    stubWindow({ "agent-last-tab-kind": "chat" })
    expect(readLastTabKind()).toBe("chat")

    // Anything unexpected falls back to chat rather than terminal.
    stubWindow({ "agent-last-tab-kind": "Terminal" })
    expect(readLastTabKind()).toBe("chat")
  })

  it("round-trips through write/read", () => {
    stubWindow()
    writeLastTabKind("terminal")
    expect(readLastTabKind()).toBe("terminal")
    writeLastTabKind("chat")
    expect(readLastTabKind()).toBe("chat")
  })

  it("write is a no-op without a window (SSR)", () => {
    delete (globalThis as { window?: unknown }).window
    expect(() => writeLastTabKind("terminal")).not.toThrow()
  })
})

describe("last-selected harness pref", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it("returns null with no window (SSR) and no stored value", () => {
    delete (globalThis as { window?: unknown }).window
    expect(readLastHarnessKey("user-1")).toBeNull()

    stubWindow()
    expect(readLastHarnessKey("user-1")).toBeNull()
  })

  it("round-trips through write/read keyed per user", () => {
    stubWindow()
    writeLastHarnessKey("user-1", "codex")
    expect(readLastHarnessKey("user-1")).toBe("codex")
    writeLastHarnessKey("user-1", "claude-code")
    expect(readLastHarnessKey("user-1")).toBe("claude-code")
  })

  it("scopes the pref per user so operators don't inherit each other's pick", () => {
    stubWindow()
    writeLastHarnessKey("user-1", "codex")
    writeLastHarnessKey("user-2", "opencode-gateway")
    expect(readLastHarnessKey("user-1")).toBe("codex")
    expect(readLastHarnessKey("user-2")).toBe("opencode-gateway")
    // A user with no pick yet reads null, not another user's value.
    expect(readLastHarnessKey("user-3")).toBeNull()
  })

  it("write is a no-op without a window (SSR)", () => {
    delete (globalThis as { window?: unknown }).window
    expect(() => writeLastHarnessKey("user-1", "codex")).not.toThrow()
  })
})
