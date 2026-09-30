// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { TerminalTabs } from "@/components/canvas/use-terminal-tabs"
import type { ChatSessionData } from "@/lib/types"

vi.mock("@/lib/terminal-tabs-actions", () => ({
  createTerminalTabAction: vi.fn().mockResolvedValue(undefined),
  deleteTerminalTabAction: vi.fn().mockResolvedValue(undefined),
  killTerminalSessionAction: vi.fn().mockResolvedValue(undefined),
}))

// Chat Sync rides along in `useChatTabs`; its effects are tested there.
vi.mock("@/hooks/use-chat-sync", () => ({ useChatSync: () => {} }))

vi.mock("@/lib/chat-store", () => ({
  chatStore: { cleanup: vi.fn() },
}))

// The respawn follows the per-user default tab kind; pin it to a chat so the
// respawn is a plain `addChatSession`.
vi.mock("@/lib/canvas/tab-kind", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/canvas/tab-kind")>()),
  readLastTabKind: () => "chat",
}))

import { useTabPool } from "./use-tab-pool"

function chat(
  id: string,
  createdAt: number,
  extra: Partial<ChatSessionData> = {}
): ChatSessionData {
  return { id, branchId: "ws-1", label: id, createdAt, ...extra }
}

function setup(chatSessions: ChatSessionData[], selectedChatId: string) {
  const deps = {
    addChatSession: vi.fn(),
    updateChatSession: vi.fn(),
    removeChatSession: vi.fn(),
    chatTarget: {
      selectedChatId,
      selectChatId: vi.fn(),
      selectAgentChat: vi.fn(),
    } as unknown as ChatTarget,
    terminalTabs: {
      localTerminals: [],
      setLocalTerminals: vi.fn(),
      isLocalTerminal: () => false,
    } as unknown as TerminalTabs,
  }
  const { result } = renderHook(() =>
    useTabPool({
      ...deps,
      roomId: "room-1",
      userId: "user-1",
      agents: [],
      chatSessions,
    })
  )
  return { tabPool: result.current, ...deps }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("useTabPool remove", () => {
  it("moves selection to the next open tab when the selected chat is removed", () => {
    const { tabPool, chatTarget, removeChatSession, addChatSession } = setup(
      [
        chat("a", 1),
        chat("b", 2),
        chat("c", 3, { closedAt: 5 }),
        chat("other", 0, { branchId: "ws-2" }),
      ],
      "b"
    )

    tabPool.remove("b")

    expect(chatTarget.selectChatId).toHaveBeenCalledWith("a")
    expect(removeChatSession).toHaveBeenCalledWith("b")
    expect(addChatSession).not.toHaveBeenCalled()
  })

  it("respawns a fresh chat when the last open tab is removed", () => {
    const { tabPool, chatTarget, removeChatSession, addChatSession } = setup(
      [chat("only", 1), chat("old", 0, { closedAt: 5 })],
      "only"
    )

    tabPool.remove("only")

    expect(removeChatSession).toHaveBeenCalledWith("only")
    expect(addChatSession).toHaveBeenCalledTimes(1)
    const [newId, data] = addChatSession.mock.calls[0]
    expect(data).toMatchObject({ branchId: "ws-1", label: "Untitled" })
    expect(chatTarget.selectChatId).toHaveBeenCalledWith(newId)
  })

  it("decides nothing when a closed chat is deleted from history", () => {
    const { tabPool, chatTarget, removeChatSession, addChatSession } = setup(
      [chat("open", 1), chat("closed", 0, { closedAt: 5 })],
      "open"
    )

    tabPool.remove("closed")

    expect(removeChatSession).toHaveBeenCalledWith("closed")
    expect(chatTarget.selectChatId).not.toHaveBeenCalled()
    expect(addChatSession).not.toHaveBeenCalled()
  })
})
