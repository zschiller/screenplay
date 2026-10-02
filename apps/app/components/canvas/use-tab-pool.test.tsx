// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { TerminalTabs } from "@/components/canvas/use-terminal-tabs"
import type { ChatSessionData } from "@/lib/types"

// Chat Sync rides along in `useChatTabs`; its effects are tested there.
vi.mock("@/hooks/use-chat-sync", () => ({ useChatSync: () => {} }))

vi.mock("@/lib/chat-store", () => ({
  chatStore: { cleanup: vi.fn() },
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
      tabs: [],
      isTerminal: () => false,
      open: vi.fn(),
      close: vi.fn(),
      rename: vi.fn(),
    } satisfies TerminalTabs,
  }
  const { result } = renderHook(() =>
    useTabPool({
      ...deps,
      roomId: "room-1",
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

  it("keeps the Workspace's own chat when asked to remove it (#1315)", () => {
    const { tabPool, removeChatSession, addChatSession } = setup(
      [chat("only", 1), chat("old", 0, { closedAt: 5 })],
      "only"
    )

    tabPool.remove("only")

    expect(removeChatSession).not.toHaveBeenCalled()
    expect(addChatSession).not.toHaveBeenCalled()
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
