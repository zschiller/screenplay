import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore } from "./chat-store"

let seq = 0
const nextId = () => `evt_err_${++seq}`
const newChat = () => `chat_err_${++seq}`

function respond(...responses: Array<{ status: number; body?: unknown }>) {
  const fetchMock = vi.fn()
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce(
      new Response(
        typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? null),
        { status: r.status }
      )
    )
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat-store — errors in plain words, with Retry", () => {
  it("says a plan approval failed, and Retry approves again", async () => {
    const chatId = newChat()
    const fetchMock = respond({ status: 500, body: "" }, { status: 200 })

    await chatStore.approvePlan("room", chatId, "plan_1")

    const [error] = chatStore.getSnapshot(chatId).messages
    expect(error).toEqual({
      role: "error",
      content: "Couldn't approve the plan.",
      detail: "HTTP 500",
    })
    expect(chatStore.canRetryError(error)).toBe(true)

    await chatStore.retryError(chatId, error)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      planId: "plan_1",
      approved: true,
    })
    expect(chatStore.getSnapshot(chatId).messages).toEqual([])
    chatStore.cleanup(chatId)
  })

  it("rewords a turn failure and keeps the raw error as its detail", async () => {
    const chatId = newChat()
    respond({ status: 200 }, { status: 200 })
    await chatStore.sendMessage({ roomId: "room", chatId, message: "Go" })

    const raw =
      "request to https://api.example.com/v1/prompt timed out after 120000ms"
    chatStore.handleBroadcastEvent({
      type: "chat-control",
      chatId,
      id: nextId(),
      control: { kind: "error", message: raw },
    })

    const messages = chatStore.getSnapshot(chatId).messages
    const error = messages[messages.length - 1]
    expect(error).toEqual({
      role: "error",
      content: "The agent stopped responding after 2 minutes.",
      detail: raw,
    })

    // Retry runs the same ask again, as a retry of the one already shown.
    const fetchMock = respond({ status: 200 })
    await chatStore.retryError(chatId, error)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: "Go",
      retry: true,
    })
    chatStore.cleanup(chatId)
  })

  it("Retry keeps one copy of the ask, however often the turn fails (#1228)", async () => {
    const chatId = newChat()
    respond({ status: 200 })
    await chatStore.sendMessage({ roomId: "room", chatId, message: "Go" })
    const fail = () =>
      chatStore.handleBroadcastEvent({
        type: "chat-control",
        chatId,
        id: nextId(),
        control: { kind: "error", message: "model overloaded" },
      })
    const lastError = () => chatStore.getSnapshot(chatId).messages.at(-1)!

    fail()
    respond({ status: 200 })
    await chatStore.retryError(chatId, lastError())
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "user", content: "Go" },
    ])

    // The retried turn fails too: Retry is offered again, on the same one copy.
    fail()
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "user", content: "Go" },
      expect.objectContaining({ role: "error" }),
    ])
    expect(chatStore.canRetryError(lastError())).toBe(true)
    chatStore.cleanup(chatId)
  })

  it("a refused Retry puts the error back with Retry, not a second copy", async () => {
    const chatId = newChat()
    respond({ status: 200 })
    await chatStore.sendMessage({ roomId: "room", chatId, message: "Go" })
    chatStore.handleBroadcastEvent({
      type: "chat-control",
      chatId,
      id: nextId(),
      control: { kind: "error", message: "model overloaded" },
    })

    respond({ status: 503 })
    const [, error] = chatStore.getSnapshot(chatId).messages
    await chatStore.retryError(chatId, error)

    const messages = chatStore.getSnapshot(chatId).messages
    expect(messages).toEqual([
      { role: "user", content: "Go" },
      expect.objectContaining({ role: "error" }),
    ])
    expect(chatStore.getSnapshot(chatId).failedSend).toBeNull()
    expect(chatStore.canRetryError(messages[1])).toBe(true)
    chatStore.cleanup(chatId)
  })

  it("offers no Retry for a turn this client didn't start", () => {
    const chatId = newChat()
    chatStore.handleBroadcastEvent({
      type: "chat-control",
      chatId,
      id: nextId(),
      control: { kind: "error", message: "fetch failed" },
    })

    const [error] = chatStore.getSnapshot(chatId).messages
    expect(error).toMatchObject({ content: "The agent couldn't be reached." })
    expect(chatStore.canRetryError(error)).toBe(false)
    chatStore.cleanup(chatId)
  })

  it("marks a failed history load, and a retry that answers clears it", async () => {
    const chatId = newChat()
    respond({ status: 502 })

    await chatStore.loadHistory(chatId)
    expect(chatStore.getSnapshot(chatId)).toMatchObject({
      historyFailed: true,
      isLoadingHistory: false,
      messages: [],
    })

    respond({ status: 200, body: [{ role: "user", content: "Hi" }] })
    await chatStore.loadHistory(chatId)
    expect(chatStore.getSnapshot(chatId)).toMatchObject({
      historyFailed: false,
      messages: [{ role: "user", content: "Hi" }],
    })
    chatStore.cleanup(chatId)
  })
})
