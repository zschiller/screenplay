import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore } from "./chat-store"
import { renderHistory } from "./agent/history-render"

let seq = 0
const nextId = () => `evt_${++seq}`

function play(
  events: Array<Parameters<typeof chatStore.handleBroadcastEvent>[0]>
) {
  for (const e of events) chatStore.handleBroadcastEvent(e)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat-store — stopping a run (#729)", () => {
  it("drops a Stopped marker into the transcript and ends the stream", () => {
    const chatId = `chat_stop_${++seq}`
    play([
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Half an ans" },
        },
      },
      {
        type: "chat-control",
        chatId,
        id: nextId(),
        control: { kind: "stopped" },
      },
      { type: "chat-stream-end", chatId, id: nextId() },
    ])

    const state = chatStore.getSnapshot(chatId)
    expect(state.isStreaming).toBe(false)
    expect(state.messages).toEqual([
      { role: "assistant", content: "Half an ans" },
      { role: "stopped" },
    ])
    chatStore.cleanup(chatId)
  })

  it("doesn't stack markers when the stop is signalled twice", () => {
    const chatId = `chat_stop_${++seq}`
    play([
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-control",
        chatId,
        id: nextId(),
        control: { kind: "stopped" },
      },
      {
        type: "chat-control",
        chatId,
        id: nextId(),
        control: { kind: "stopped" },
      },
    ])
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "stopped" },
    ])
    chatStore.cleanup(chatId)
  })

  it("reloads the same marker the live stop showed", () => {
    expect(renderHistory([{ kind: "stopped" }])).toEqual([{ role: "stopped" }])
  })

  it("shows a failed stop in the transcript", async () => {
    const chatId = `chat_stop_${++seq}`
    play([{ type: "chat-stream-start", chatId, id: nextId() }])
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Run not found", { status: 500 }))
    )

    await chatStore.stopMessage("room_1", chatId)

    const state = chatStore.getSnapshot(chatId)
    expect(state.isStreaming).toBe(false)
    expect(state.messages).toEqual([
      {
        role: "error",
        content: "Couldn't stop the agent.",
        detail: "Run not found",
      },
    ])
    expect(chatStore.canRetryError(state.messages[0])).toBe(true)
    chatStore.cleanup(chatId)
  })
})
