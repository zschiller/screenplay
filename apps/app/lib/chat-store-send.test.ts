import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore } from "./chat-store"

let seq = 0
const nextId = () => `evt_send_${++seq}`
const newChat = () => `chat_send_${++seq}`

function send(chatId: string, message: string, draft?: unknown) {
  return chatStore.sendMessage({ roomId: "room", chatId, message, draft })
}

function stubFetch(...responses: Array<{ ok: boolean; body?: string }>) {
  const fetchMock = vi.fn()
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok,
      status: r.ok ? 200 : 503,
      text: async () => r.body ?? "",
      json: async () => null,
    })
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat-store — a send the server refuses (#802)", () => {
  it("holds the message for Retry instead of dropping it", async () => {
    const chatId = newChat()
    stubFetch({ ok: false, body: "The agent couldn't be reached" })
    const draft = { type: "doc", content: [] }

    expect(await send(chatId, "Make it sticky", draft)).toBe(false)

    const state = chatStore.getSnapshot(chatId)
    // The optimistic bubble is gone; the text lives in `failedSend` alone.
    expect(state.messages).toEqual([])
    expect(state.failedSend).toMatchObject({
      message: "Make it sticky",
      error: "The agent couldn't be reached",
      draft,
    })
    chatStore.cleanup(chatId)
  })

  it("sends the same message again on Retry", async () => {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: false, body: "down" }, { ok: true })
    await send(chatId, "Make it sticky")

    expect(await chatStore.retryFailedSend(chatId)).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.message).toBe("Make it sticky")
    const state = chatStore.getSnapshot(chatId)
    expect(state.failedSend).toBeNull()
    expect(state.messages).toEqual([
      { role: "user", content: "Make it sticky" },
    ])
    chatStore.cleanup(chatId)
  })

  it("hands the message back for Edit and forgets it", async () => {
    const chatId = newChat()
    stubFetch({ ok: false, body: "down" })
    await send(chatId, "Make it sticky", { type: "doc" })

    expect(chatStore.takeFailedSend(chatId)).toMatchObject({
      message: "Make it sticky",
      draft: { type: "doc" },
    })
    expect(chatStore.getSnapshot(chatId).failedSend).toBeNull()
    chatStore.cleanup(chatId)
  })
})

describe("chat-store — queueing during a run (#802)", () => {
  it("queues a message sent mid-run and sends it when the run ends", async () => {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: true })
    chatStore.handleBroadcastEvent({
      type: "chat-stream-start",
      chatId,
      id: nextId(),
    })

    expect(await send(chatId, "Then the cart")).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(chatStore.getSnapshot(chatId).queued).toMatchObject([
      { message: "Then the cart" },
    ])

    chatStore.handleBroadcastEvent({
      type: "chat-stream-end",
      chatId,
      id: nextId(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).toBe(
      "Then the cart"
    )
    expect(chatStore.getSnapshot(chatId).queued).toEqual([])
    chatStore.cleanup(chatId)
  })

  it("never sends a queued message that was cancelled", () => {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: true })
    chatStore.handleBroadcastEvent({
      type: "chat-stream-start",
      chatId,
      id: nextId(),
    })
    void send(chatId, "Then the cart")
    const [item] = chatStore.getSnapshot(chatId).queued

    expect(chatStore.takeQueued(chatId, item.id)?.message).toBe("Then the cart")
    chatStore.handleBroadcastEvent({
      type: "chat-stream-end",
      chatId,
      id: nextId(),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    chatStore.cleanup(chatId)
  })
})
