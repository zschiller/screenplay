import { describe, expect, it } from "vitest"

import {
  buildTabPool,
  resolveTabClose,
  type TabPool,
} from "@/lib/chat/tab-pool"
import type { ChatSessionData } from "@/lib/types"

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

describe("buildTabPool", () => {
  it("leaves out chats saved against a Document before #1314", () => {
    const agentChat = chat("a1", 1, { branchId: "branch-1" })
    // A retired document chat: neither a Branch nor the Room.
    const docChat = chat("d1", 2, {})
    const agentPool = buildTabPool({ kind: "agent", branchId: "branch-1" }, [
      agentChat,
      docChat,
    ])
    expect(agentPool.chats.map((c) => c.id)).toEqual(["a1"])
  })

  it("excludes closed earlier chats and other Branches' chats", () => {
    const chats = [
      chat("a1", 1, { branchId: "branch-1" }, { closedAt: 99 }),
      chat("a2", 2, { branchId: "branch-1" }),
      chat("a3", 3, { branchId: "branch-2" }),
    ]

    const pool = buildTabPool({ kind: "agent", branchId: "branch-1" }, chats)
    expect(pool.chats.map((c) => c.id)).toEqual(["a2"])
  })

  it("keeps the Workspace's own chat even when it was closed (#1315)", () => {
    const chats = [
      chat("a1", 1, { branchId: "branch-1" }, { closedAt: 50 }),
      chat("a2", 2, { branchId: "branch-1" }, { closedAt: 99 }),
    ]
    const pool = buildTabPool({ kind: "agent", branchId: "branch-1" }, chats)
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
    }
    // Closing the selected a2 → earliest surviving chat (a1) by createdAt.
    const outcome = resolveTabClose(pool, "a2", "a2")
    expect(outcome.nextSelectedId).toBe("a1")
  })

  it("honours an explicit next-selection hint over the fallbacks", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [
        chat("a1", 1, { branchId: "branch-1" }),
        chat("a2", 2, { branchId: "branch-1" }),
        chat("a3", 3, { branchId: "branch-1" }),
      ],
    }
    const outcome = resolveTabClose(pool, "a1", "a1", "a3")
    expect(outcome.nextSelectedId).toBe("a3")
  })

  it("respawns the agent default when the last agent tab is closed", () => {
    const pool: TabPool = {
      target: agentTarget,
      chats: [chat("a1", 1, { branchId: "branch-1" })],
    }
    const outcome = resolveTabClose(pool, "a1", "a1")
    expect(outcome.respawn).toEqual({ target: "agent", branchId: "branch-1" })
    expect(outcome.surviving).toEqual([])
  })
})
