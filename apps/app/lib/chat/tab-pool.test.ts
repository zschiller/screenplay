import { describe, expect, it } from "vitest"

import {
  buildTabPool,
  resolveTabClose,
  type TabPool,
} from "@/lib/chat/tab-pool"
import type { ChatSessionData, TerminalTabData } from "@/lib/types"

function chat(
  id: string,
  createdAt: number,
  target: { branchId?: string },
  extra: Partial<ChatSessionData> = {}
): ChatSessionData {
  return {
    id,
    label: "Untitled",
    createdAt,
    ...target,
    ...extra,
  }
}

function terminal(
  id: string,
  createdAt: number,
  branchId: string
): TerminalTabData {
  return {
    id,
    branchId,
    terminalSessionId: id,
    label: "Terminal",
    createdAt,
  }
}

describe("buildTabPool", () => {
  it("leaves out chats saved against a Document before #1314", () => {
    const agentChat = chat("a1", 1, { branchId: "branch-1" })
    // A retired document chat: neither a Branch nor the Room.
    const docChat = chat("d1", 2, {})
    const agentPool = buildTabPool(
      { kind: "agent", branchId: "branch-1" },
      [agentChat, docChat],
      []
    )
    expect(agentPool.chats.map((c) => c.id)).toEqual(["a1"])
  })

  it("excludes closed earlier chats and includes the agent's terminals", () => {
    const chats = [
      chat("a1", 1, { branchId: "branch-1" }, { closedAt: 99 }),
      chat("a2", 2, { branchId: "branch-1" }),
      chat("a3", 3, { branchId: "branch-2" }),
    ]
    const terminals = [
      terminal("t1", 1, "branch-1"),
      terminal("t2", 2, "branch-2"),
    ]

    const pool = buildTabPool(
      { kind: "agent", branchId: "branch-1" },
      chats,
      terminals
    )
    expect(pool.chats.map((c) => c.id)).toEqual(["a2"])
    expect(pool.terminals.map((t) => t.id)).toEqual(["t1"])
  })

  it("keeps the Workspace's own chat even when it was closed (#1315)", () => {
    const chats = [
      chat("a1", 1, { branchId: "branch-1" }, { closedAt: 50 }),
      chat("a2", 2, { branchId: "branch-1" }, { closedAt: 99 }),
    ]
    const pool = buildTabPool(
      { kind: "agent", branchId: "branch-1" },
      chats,
      []
    )
    expect(pool.chats.map((c) => c.id)).toEqual(["a2"])
  })
})

describe("resolveTabClose", () => {
  const agentTarget = { kind: "agent" as const, branchId: "branch-1" }

  it("leaves selection untouched when a non-selected tab is closed", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [
        chat("a1", 1, { branchId: "branch-1" }),
        chat("a2", 2, { branchId: "branch-1" }),
      ],
      terminals: [],
    }
    const outcome = resolveTabClose(pool, "a1", "a2")
    expect(outcome.respawn).toBeUndefined()
    expect(outcome.nextSelectedId).toBeUndefined()
    expect(outcome.surviving.map((t) => t.id)).toEqual(["a2"])
  })

  it("falls back to the first sibling chat when the selected tab is closed", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [
        chat("a2", 2, { branchId: "branch-1" }),
        chat("a1", 1, { branchId: "branch-1" }),
        chat("a3", 3, { branchId: "branch-1" }),
      ],
      terminals: [],
    }
    // Closing the selected a2 → earliest surviving chat (a1) by createdAt.
    const outcome = resolveTabClose(pool, "a2", "a2")
    expect(outcome.nextSelectedId).toBe("a1")
  })

  it("prefers a sibling chat over a terminal in the fallback order", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [chat("a2", 5, { branchId: "branch-1" })],
      terminals: [terminal("t1", 1, "branch-1")],
    }
    // Closing selected a1 → chat (a2) wins over the older terminal (t1).
    const outcome = resolveTabClose(
      {
        ...pool,
        chats: [chat("a1", 1, { branchId: "branch-1" }), ...pool.chats],
      },
      "a1",
      "a1"
    )
    expect(outcome.nextSelectedId).toBe("a2")
  })

  it("falls back to a terminal when no sibling chat survives", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [chat("a1", 1, { branchId: "branch-1" })],
      terminals: [terminal("t1", 2, "branch-1")],
    }
    const outcome = resolveTabClose(pool, "a1", "a1")
    expect(outcome.respawn).toBeUndefined()
    expect(outcome.nextSelectedId).toBe("t1")
  })

  it("honours an explicit next-selection hint over the fallbacks", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [
        chat("a1", 1, { branchId: "branch-1" }),
        chat("a2", 2, { branchId: "branch-1" }),
        chat("a3", 3, { branchId: "branch-1" }),
      ],
      terminals: [],
    }
    const outcome = resolveTabClose(pool, "a1", "a1", "a3")
    expect(outcome.nextSelectedId).toBe("a3")
  })

  it("respawns the agent default when the last agent tab is closed", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [chat("a1", 1, { branchId: "branch-1" })],
      terminals: [],
    }
    const outcome = resolveTabClose(pool, "a1", "a1")
    expect(outcome.respawn).toEqual({ target: "agent", branchId: "branch-1" })
    expect(outcome.surviving).toEqual([])
  })

  it("keeps a surviving terminal next to a closed last chat — no respawn", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [chat("a1", 1, { branchId: "branch-1" })],
      terminals: [terminal("t1", 2, "branch-1")],
    }
    // Closing the last chat leaves the terminal standing; the panel is not
    // force-spawned a new chat.
    const outcome = resolveTabClose(pool, "a1", "a2")
    expect(outcome.respawn).toBeUndefined()
    expect(outcome.surviving.map((t) => t.id)).toEqual(["t1"])
  })

  it("respawns when the last terminal is closed with no sibling chat", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [],
      terminals: [terminal("t1", 1, "branch-1")],
    }
    const outcome = resolveTabClose(pool, "t1", "t1")
    expect(outcome.respawn).toEqual({ target: "agent", branchId: "branch-1" })
  })
})
