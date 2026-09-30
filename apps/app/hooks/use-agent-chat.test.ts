// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { chatStore } from "@/lib/chat-store"
import { useAgentChat } from "./use-agent-chat"

// Every open chat tab stays mounted, so a finished run is marked read only by
// the chat that's on screen (#801). A background tab keeps its unread dot until
// it's shown.

function finishRun(chatId: string) {
  act(() => {
    chatStore.handleBroadcastEvent({
      type: "chat-stream-start",
      chatId,
      id: `${chatId}-start`,
    } as never)
    chatStore.handleBroadcastEvent({
      type: "chat-stream-end",
      chatId,
      id: `${chatId}-end`,
    } as never)
  })
}

const ROOM = { kind: "room" } as const

describe("useAgentChat unread", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 }))
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("keeps a background chat's finished run unread", () => {
    renderHook(() =>
      useAgentChat({
        chatId: "bg",
        roomId: "room",
        target: ROOM,
        isActive: false,
      })
    )
    finishRun("bg")
    expect(chatStore.hasUnread("bg")).toBe(true)
    chatStore.cleanup("bg")
  })

  it("marks the chat on screen read", () => {
    renderHook(() =>
      useAgentChat({
        chatId: "fg",
        roomId: "room",
        target: ROOM,
        isActive: true,
      })
    )
    finishRun("fg")
    expect(chatStore.hasUnread("fg")).toBe(false)
    chatStore.cleanup("fg")
  })

  it("clears unread when a background chat comes on screen", () => {
    const { rerender } = renderHook(
      ({ isActive }) =>
        useAgentChat({
          chatId: "later",
          roomId: "room",
          target: ROOM,
          isActive,
        }),
      { initialProps: { isActive: false } }
    )
    finishRun("later")
    expect(chatStore.hasUnread("later")).toBe(true)
    rerender({ isActive: true })
    expect(chatStore.hasUnread("later")).toBe(false)
    chatStore.cleanup("later")
  })

  it("keeps its send when the caller rebuilds the same target", () => {
    const { result, rerender } = renderHook(() =>
      useAgentChat({ chatId: "same", roomId: "room", target: { kind: "room" } })
    )
    const first = result.current.sendMessage
    rerender()
    expect(result.current.sendMessage).toBe(first)
    chatStore.cleanup("same")
  })
})
