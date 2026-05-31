import { describe, expect, it } from "vitest"

import type { ChatSessionData } from "@/lib/types"
import { createTerminalTab, isTerminalTab, persistsConversation, tabKind } from "@/lib/canvas/tab-kind"

function session(overrides: Partial<ChatSessionData> = {}): ChatSessionData {
  return { id: "s1", label: "Untitled", createdAt: 0, ...overrides }
}

describe("tabKind", () => {
  it("reads a legacy chat tab (no kind field) as a chat", () => {
    // Existing chat-tab data predates the discriminant — it must keep working
    // as a chat, not silently become something else.
    expect(tabKind(session({ branchId: "agent-1" }))).toBe("chat")
  })

  it("reads an explicit terminal tab as a terminal", () => {
    expect(tabKind(session({ kind: "terminal" }))).toBe("terminal")
  })
})

describe("isTerminalTab", () => {
  it("is true only for terminal tabs", () => {
    expect(isTerminalTab(session({ kind: "terminal" }))).toBe(true)
    expect(isTerminalTab(session({ branchId: "agent-1" }))).toBe(false)
  })
})

describe("createTerminalTab", () => {
  it("produces a terminal-kind tab bound to the agent's sandbox", () => {
    const tab = createTerminalTab({ id: "t1", branchId: "agent-1", createdAt: 5 })

    expect(tabKind(tab)).toBe("terminal")
    expect(tab.branchId).toBe("agent-1")
    expect(tab.createdAt).toBe(5)
    // The shared live-view identity collaborators co-view against is the tab's
    // own id, so opening the same tab on a second client co-views one PTY.
    expect(tab.terminalSessionId).toBe("t1")
  })

  it("is not a conversation: no markdown-layer target and a terminal label", () => {
    const tab = createTerminalTab({ id: "t1", branchId: "agent-1", createdAt: 0 })

    expect(tab.markdownLayerId).toBeUndefined()
    expect(tab.label).toBe("Terminal")
  })
})

describe("persistsConversation", () => {
  it("persists a chat tab's conversation", () => {
    expect(persistsConversation(session({ branchId: "agent-1" }))).toBe(true)
  })

  it("never persists a terminal tab's scrollback", () => {
    // The guard the chat-store / history / broadcast paths consult so terminal
    // scrollback can never reach Postgres or the Y.Doc conversation model.
    const terminal = createTerminalTab({ id: "t1", branchId: "agent-1", createdAt: 0 })
    expect(persistsConversation(terminal)).toBe(false)
  })
})
