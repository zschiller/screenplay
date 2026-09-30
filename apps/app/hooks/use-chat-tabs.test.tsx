// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatBroadcastEvent } from "@/lib/chat-store"
import type { ChatSessionData } from "@/lib/types"

// The room's stream-event feed, captured so a test can deliver
// `chat-stream-start` / `chat-stream-end` as the Y.Doc would.
let streamListener: ((e: ChatBroadcastEvent) => void) | null = null
vi.mock("@/lib/yjs/react", () => ({
  useChatStreamEvents: (onEvent: (e: ChatBroadcastEvent) => void) => {
    streamListener = onEvent
  },
}))

vi.mock("@/lib/chat-store", () => ({
  chatStore: {
    cleanup: vi.fn(),
    loadHistory: vi.fn(),
    setStreaming: vi.fn(),
    handleBroadcastEvent: vi.fn(),
  },
}))

import { chatStore } from "@/lib/chat-store"
import { useChatTabs, type ChatTabsDeps } from "./use-chat-tabs"

function chat(
  id: string,
  createdAt: number,
  extra: Partial<ChatSessionData> = {}
): ChatSessionData {
  return { id, branchId: "ws-1", label: id, createdAt, ...extra }
}

/**
 * A fake Chat Session collection: an in-memory map with the same writers the
 * hosts pass (`set` / `update` / `delete`), re-rendering the hook on each write
 * the way the synced Y.Doc does. Selection is plain state, as in the player.
 */
function setup(
  initial: ChatSessionData[],
  selected: string | null,
  extra: Partial<ChatTabsDeps> = {}
) {
  const sessions = new Map(initial.map((c) => [c.id, c]))
  const state = { selectedChatId: selected }
  const selectChat = vi.fn((id: string | null) => {
    state.selectedChatId = id
  })
  const deps = (): ChatTabsDeps => ({
    roomId: "room-1",
    chatSessions: [...sessions.values()],
    addChatSession: (id, data) => {
      sessions.set(id, data)
      rerender()
    },
    updateChatSession: (id, patch) => {
      const prev = sessions.get(id)
      if (prev) sessions.set(id, { ...prev, ...patch })
      rerender()
    },
    removeChatSession: (id) => {
      sessions.delete(id)
      rerender()
    },
    selectedChatId: state.selectedChatId,
    selectChat,
    ...extra,
  })
  const hook = renderHook(() => useChatTabs(deps()))
  function rerender() {
    hook.rerender()
  }
  return {
    tabs: () => hook.result.current,
    sessions,
    state,
    selectChat,
    openIds: () =>
      [...sessions.values()].filter((c) => !c.closedAt).map((c) => c.id),
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 }))
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  streamListener = null
})

describe("useChatTabs close", () => {
  it("archives the selected chat and selects the first sibling", () => {
    const { tabs, sessions, state } = setup(
      [chat("a", 1), chat("b", 2), chat("other", 0, { branchId: "ws-2" })],
      "b"
    )

    act(() => tabs().close("b"))

    expect(sessions.get("b")?.closedAt).toBeGreaterThan(0)
    expect(state.selectedChatId).toBe("a")
  })

  it("prefers the tab strip's neighbour when it names one", () => {
    const { tabs, state } = setup(
      [chat("a", 1), chat("b", 2), chat("c", 3)],
      "b"
    )

    act(() => tabs().close("b", "c"))

    expect(state.selectedChatId).toBe("c")
  })

  it("leaves selection alone when a background tab closes", () => {
    const { tabs, selectChat } = setup([chat("a", 1), chat("b", 2)], "a")

    act(() => tabs().close("b"))

    expect(selectChat).not.toHaveBeenCalled()
  })

  it("respawns a fresh chat when the last open tab closes", () => {
    const { tabs, state, openIds, selectChat } = setup(
      [chat("only", 1)],
      "only"
    )

    act(() => tabs().close("only"))

    const [fresh] = openIds()
    expect(fresh).toBeDefined()
    expect(fresh).not.toBe("only")
    expect(state.selectedChatId).toBe(fresh)
    expect(selectChat).toHaveBeenCalledWith(fresh, {
      kind: "agent",
      branchId: "ws-1",
    })
  })

  it("hands an agent respawn to respawnAgent when the host passes one", () => {
    const respawnAgent = vi.fn()
    const { tabs, openIds } = setup([chat("only", 1)], "only", {
      respawnAgent,
    })

    act(() => tabs().close("only"))

    expect(respawnAgent).toHaveBeenCalledWith("ws-1")
    expect(openIds()).toEqual([])
  })

  it("counts the host's terminals toward the pool", () => {
    const { tabs, state, openIds } = setup([chat("only", 1)], "only", {
      terminals: [
        {
          id: "term",
          branchId: "ws-1",
          label: "Terminal",
          createdAt: 2,
          terminalSessionId: "term",
        } as never,
      ],
    })

    act(() => tabs().close("only"))

    expect(openIds()).toEqual([])
    expect(state.selectedChatId).toBe("term")
  })
})

describe("useChatTabs remove", () => {
  it("deletes the selected chat and selects the next open one", () => {
    const { tabs, sessions, state } = setup(
      [chat("a", 1), chat("b", 2), chat("c", 3, { closedAt: 5 })],
      "b"
    )

    act(() => tabs().remove("b"))

    expect(sessions.has("b")).toBe(false)
    expect(chatStore.cleanup).toHaveBeenCalledWith("b")
    expect(state.selectedChatId).toBe("a")
  })

  it("respawns a fresh chat when the last open tab is removed", () => {
    const { tabs, sessions, state, openIds } = setup(
      [chat("only", 1), chat("old", 0, { closedAt: 5 })],
      "only"
    )

    act(() => tabs().remove("only"))

    expect(sessions.has("only")).toBe(false)
    const [fresh] = openIds()
    expect(sessions.get(fresh)).toMatchObject({
      branchId: "ws-1",
      label: "Untitled",
    })
    expect(state.selectedChatId).toBe(fresh)
  })

  it("decides nothing when a closed chat is deleted from history", () => {
    const { tabs, sessions, selectChat, openIds } = setup(
      [chat("open", 1), chat("closed", 0, { closedAt: 5 })],
      "open"
    )

    act(() => tabs().remove("closed"))

    expect(sessions.has("closed")).toBe(false)
    expect(selectChat).not.toHaveBeenCalled()
    expect(openIds()).toEqual(["open"])
  })
})

describe("useChatTabs open and reopen", () => {
  it("opens a chat on the target and selects it", () => {
    const { tabs, sessions, state } = setup([chat("a", 1)], "a")

    let id = ""
    act(() => {
      id = tabs().open({ kind: "agent", branchId: "ws-1" })
    })

    expect(sessions.get(id)).toMatchObject({ branchId: "ws-1" })
    expect(state.selectedChatId).toBe(id)
  })

  it("reopens a closed chat and selects it", () => {
    const { tabs, sessions, state } = setup(
      [chat("a", 1), chat("b", 2, { closedAt: 5 })],
      "a"
    )

    act(() => tabs().reopen("b"))

    expect(sessions.get("b")?.closedAt).toBe(0)
    expect(state.selectedChatId).toBe("b")
  })
})

describe("useChatTabs Chat Sync", () => {
  it("heals a chat left streaming whose stream end was missed", () => {
    setup([chat("a", 1, { isStreaming: true }), chat("b", 2)], "a")

    expect(chatStore.setStreaming).toHaveBeenCalledWith("a", true)
    expect(chatStore.setStreaming).not.toHaveBeenCalledWith("b", true)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain("/api/branch/heal")
    expect(JSON.parse(String(init?.body))).toEqual({
      roomId: "room-1",
      chatId: "a",
    })
  })

  it("loads history for every chat", () => {
    setup([chat("a", 1), chat("b", 2, { closedAt: 5 })], "a")

    expect(chatStore.loadHistory).toHaveBeenCalledWith("a")
    expect(chatStore.loadHistory).toHaveBeenCalledWith("b")
  })

  it("mirrors stream start and end into the Chat Session", () => {
    const { sessions } = setup([chat("a", 1)], "a")

    act(() =>
      streamListener?.({ type: "chat-stream-start", chatId: "a" } as never)
    )
    expect(sessions.get("a")?.isStreaming).toBe(true)

    act(() =>
      streamListener?.({ type: "chat-stream-end", chatId: "a" } as never)
    )
    expect(sessions.get("a")?.isStreaming).toBe(false)
    expect(chatStore.handleBroadcastEvent).toHaveBeenCalledTimes(2)
  })
})
