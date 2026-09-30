import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore, type ChatControlEvent } from "./chat-store"
import { userMessageChunk } from "./agent/acp/schema"

let seq = 0
const nextId = () => `evt_steer_${++seq}`
const newChat = () => `chat_steer_${++seq}`

function send(chatId: string, message: string, draft?: unknown) {
  return chatStore.sendMessage({
    roomId: "room",
    chatId,
    target: { kind: "room" },
    message,
    draft,
  })
}

/** Answer the stream route: `body` as JSON with `status`. */
function answer(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this
    },
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const control = (chatId: string, c: ChatControlEvent) =>
  chatStore.handleBroadcastEvent({
    type: "chat-control",
    chatId,
    id: nextId(),
    control: c,
  })
const startRun = (chatId: string) =>
  chatStore.handleBroadcastEvent({
    type: "chat-stream-start",
    chatId,
    id: nextId(),
  })
const echo = (chatId: string, text: string) =>
  chatStore.handleBroadcastEvent({
    type: "chat-acp-update",
    chatId,
    id: nextId(),
    update: userMessageChunk(text),
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat-store — steering a running turn (#1190)", () => {
  it("posts a mid-run send, shows it pending, then settles it where the agent takes it", async () => {
    const chatId = newChat()
    startRun(chatId)
    control(chatId, { kind: "steerable", steerable: true })
    const fetchMock = answer({ steered: true, steerId: "s1" })

    expect(await send(chatId, "also run the tests")).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(chatStore.getSnapshot(chatId).pendingSteers).toMatchObject([
      { id: "s1", message: "also run the tests" },
    ])
    // The server's own pending broadcast doesn't draw it twice.
    control(chatId, {
      kind: "steer_pending",
      steer: { id: "s1", message: "also run the tests" },
    })
    expect(chatStore.getSnapshot(chatId).pendingSteers).toHaveLength(1)
    expect(chatStore.getSnapshot(chatId).queued).toEqual([])

    control(chatId, { kind: "steers_taken", ids: ["s1"] })
    echo(chatId, "also run the tests")

    const state = chatStore.getSnapshot(chatId)
    expect(state.pendingSteers).toEqual([])
    expect(state.messages).toEqual([
      { role: "user", content: "also run the tests" },
    ])
    chatStore.cleanup(chatId)
  })

  it("names its own pending Steer when the broadcast beats the answer", async () => {
    const chatId = newChat()
    startRun(chatId)
    let resolve!: (v: unknown) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r
          })
      )
    )
    const sent = send(chatId, "use v2")
    control(chatId, {
      kind: "steer_pending",
      steer: { id: "s1", message: "use v2" },
    })
    // Taken before the send's answer came back.
    control(chatId, { kind: "steers_taken", ids: ["s1"] })
    resolve({
      ok: true,
      status: 200,
      json: async () => ({ steered: true, steerId: "s1" }),
    })
    await sent

    expect(chatStore.getSnapshot(chatId).pendingSteers).toEqual([])
    chatStore.cleanup(chatId)
  })

  it("shows another member's Steer pending too", () => {
    const chatId = newChat()
    startRun(chatId)
    control(chatId, {
      kind: "steer_pending",
      steer: { id: "s9", message: "check mobile" },
    })
    expect(chatStore.getSnapshot(chatId).pendingSteers).toMatchObject([
      { id: "s9", message: "check mobile" },
    ])
    chatStore.cleanup(chatId)
  })

  it("falls back to the Queued row when the run can't be steered", async () => {
    const chatId = newChat()
    startRun(chatId)
    answer({ error: "not_steerable" }, 409)

    expect(await send(chatId, "then the cart", { type: "doc" })).toBe(true)

    const state = chatStore.getSnapshot(chatId)
    expect(state.pendingSteers).toEqual([])
    expect(state.queued).toMatchObject([
      { message: "then the cart", draft: { type: "doc" } },
    ])
    expect(state.steerable).toBe(false)
    chatStore.cleanup(chatId)
  })

  it("a run that ended meanwhile starts a turn with the message, which its echo shows", async () => {
    const chatId = newChat()
    startRun(chatId)
    answer({ chatId, runId: "run_2" })

    await send(chatId, "one more thing")
    expect(chatStore.getSnapshot(chatId).pendingSteers).toEqual([])
    echo(chatId, "one more thing")
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "user", content: "one more thing" },
    ])
    chatStore.cleanup(chatId)
  })

  it("an idle-looking chat whose run the server knows about steers it instead of adding a turn", async () => {
    const chatId = newChat()
    answer({ steered: true, steerId: "s1" })

    await send(chatId, "and the header")

    const state = chatStore.getSnapshot(chatId)
    expect(state.messages).toEqual([])
    expect(state.pendingSteers).toMatchObject([
      { id: "s1", message: "and the header" },
    ])
    chatStore.cleanup(chatId)
  })

  it("puts Steers a stop handed back into the sender's composer, and nobody else's", async () => {
    const chatId = newChat()
    startRun(chatId)
    answer({ steered: true, steerId: "s1" })
    const draft = { type: "doc", content: [] }
    await send(chatId, "actually, wait", draft)
    control(chatId, {
      kind: "steer_pending",
      steer: { id: "s2", message: "someone else's" },
    })

    control(chatId, {
      kind: "steers_returned",
      steers: [
        { id: "s1", message: "actually, wait", userId: "u_1" },
        { id: "s2", message: "someone else's", userId: "u_2" },
      ],
    })

    const state = chatStore.getSnapshot(chatId)
    expect(state.pendingSteers).toEqual([])
    expect(chatStore.takeReturnedSteers(chatId)).toEqual([
      { message: "actually, wait", draft },
    ])
    expect(chatStore.getSnapshot(chatId).returnedSteers).toEqual([])
    chatStore.cleanup(chatId)
  })
})
