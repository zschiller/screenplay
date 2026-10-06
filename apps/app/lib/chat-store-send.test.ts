import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore } from "./chat-store"
import { buildCanvasViewFooter } from "./agent/message-markers"
import type { ChatTarget } from "./chat/chat-target"

let seq = 0
const nextId = () => `evt_send_${++seq}`
const newChat = () => `chat_send_${++seq}`

function send(chatId: string, message: string, draft?: unknown) {
  return chatStore.sendMessage({
    roomId: "room",
    chatId,
    target: { kind: "room" },
    message,
    draft,
  })
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

/** A run starts on an Engine that can't take Steers, so sends queue. */
function startUnsteerableRun(chatId: string) {
  chatStore.handleBroadcastEvent({
    type: "chat-stream-start",
    chatId,
    id: nextId(),
  })
  chatStore.handleBroadcastEvent({
    type: "chat-control",
    chatId,
    id: nextId(),
    control: { kind: "steerable", steerable: false },
  })
}

describe("chat-store — queueing during a run that can't steer (#802)", () => {
  it("queues a message sent mid-run and sends it when the run ends", async () => {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: true })
    startUnsteerableRun(chatId)

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

  it("counts a queued message as this chat’s send once it goes", () => {
    const chatId = newChat()
    stubFetch({ ok: true }, { ok: true })
    void send(chatId, "Make it sticky")
    expect(chatStore.getSnapshot(chatId).sends).toBe(1)
    startUnsteerableRun(chatId)

    void send(chatId, "Then the cart")
    // Waiting in the queue, it isn't in the chat yet.
    expect(chatStore.getSnapshot(chatId).sends).toBe(1)

    chatStore.handleBroadcastEvent({
      type: "chat-stream-end",
      chatId,
      id: nextId(),
    })
    expect(chatStore.getSnapshot(chatId).sends).toBe(2)
    chatStore.cleanup(chatId)
  })

  it("never sends a queued message that was cancelled", () => {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: true })
    startUnsteerableRun(chatId)
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

describe("chat-store — the Chat Target on the wire", () => {
  async function bodyFor(target: ChatTarget) {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: true })
    await chatStore.sendMessage({
      roomId: "room",
      chatId,
      target,
      message: "Hi",
    })
    chatStore.cleanup(chatId)
    return JSON.parse(fetchMock.mock.calls[0][1].body)
  }

  it("names an agent chat's sandbox", async () => {
    expect(
      await bodyFor({ kind: "agent", branchId: "b1", sandboxName: "sbx-1" })
    ).toEqual({
      roomId: "room",
      chatId: expect.any(String),
      sandboxName: "sbx-1",
      message: "Hi",
    })
  })

  it("names the Room for the Coordinator chat", async () => {
    expect(await bodyFor({ kind: "room" })).toEqual({
      roomId: "room",
      chatId: expect.any(String),
      target: "room",
      message: "Hi",
    })
  })
})

describe("chat-store — the sender's Canvas view", () => {
  const canvasView = {
    sender: "Maya",
    selected: [{ kind: "frame" as const, id: "f1", name: "Checkout" }],
    onScreen: [],
  }

  it("rides the message to the server as a footer", async () => {
    const chatId = newChat()
    const fetchMock = stubFetch({ ok: true })
    await chatStore.sendMessage({
      roomId: "room",
      chatId,
      target: { kind: "room" },
      message: "Make this sticky",
      canvasView,
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.message).toBe(
      "Make this sticky" + buildCanvasViewFooter(canvasView)
    )
    // What the chat shows never carries it.
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "user", content: "Make this sticky" },
    ])
    chatStore.cleanup(chatId)
  })

  it("stays out of a message held for Edit", async () => {
    const chatId = newChat()
    stubFetch({ ok: false, body: "down" })
    await chatStore.sendMessage({
      roomId: "room",
      chatId,
      target: { kind: "room" },
      message: "Make this sticky",
      canvasView,
    })

    expect(chatStore.takeFailedSend(chatId)?.message).toBe("Make this sticky")
    chatStore.cleanup(chatId)
  })
})

describe("chat-store — a first message shown while it waits", () => {
  it("shows at once, and its send takes it over without adding it again", async () => {
    const chatId = newChat()
    const opts = {
      roomId: "room",
      chatId,
      target: { kind: "room" } as ChatTarget,
      message: "Make it sticky",
    }
    chatStore.showWaiting(opts)
    expect(chatStore.getSnapshot(chatId).messages).toMatchObject([
      { role: "user", content: "Make it sticky" },
    ])

    stubFetch({ ok: true })
    expect(await chatStore.sendMessage(opts)).toBe(true)
    const state = chatStore.getSnapshot(chatId)
    expect(state.messages).toHaveLength(1)
    expect(state.sends).toBe(1)
    chatStore.cleanup(chatId)
  })

  it("leaves the log as it was when its send is refused", async () => {
    const chatId = newChat()
    const opts = {
      roomId: "room",
      chatId,
      target: { kind: "room" } as ChatTarget,
      message: "Make it sticky",
    }
    chatStore.showWaiting(opts)
    stubFetch({ ok: false, body: "down" })

    expect(await chatStore.sendMessage(opts)).toBe(false)
    const state = chatStore.getSnapshot(chatId)
    expect(state.messages).toEqual([])
    expect(state.failedSend).toMatchObject({ message: "Make it sticky" })
    chatStore.cleanup(chatId)
  })
})
