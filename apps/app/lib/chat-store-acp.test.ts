import { describe, expect, it } from "vitest"
import { chatStore } from "./chat-store"
import { agentMessageChunk } from "./agent/acp/schema"

let seq = 0
const nextId = () => `evt_${++seq}`

/** Drive a fresh chat through a sequence of broadcast events. */
function play(
  chatId: string,
  events: Array<Parameters<typeof chatStore.handleBroadcastEvent>[0]>
) {
  for (const e of events) chatStore.handleBroadcastEvent(e)
}

describe("chat-store — ACP text path (renders the server's broadcast)", () => {
  it("accumulates agent_message_chunk deltas into one assistant message", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("Hel"),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("lo"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "Hello" },
    ])
    chatStore.cleanup(chatId)
  })

  it("starts a fresh assistant block per turn (stream-start resets the accumulator)", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("first"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("second"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ])
    chatStore.cleanup(chatId)
  })

  it("dedups a chunk delivered by two subscribers (same event id)", () => {
    const chatId = `chat_${++seq}`
    const startId = nextId()
    const chunkId = nextId()
    play(chatId, [
      { type: "chat-stream-start", chatId, id: startId },
      {
        type: "chat-acp-update",
        chatId,
        id: chunkId,
        update: agentMessageChunk("once"),
      },
      // Same event id again (second Room subscriber) — must not double-apply.
      {
        type: "chat-acp-update",
        chatId,
        id: chunkId,
        update: agentMessageChunk("once"),
      },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "once" },
    ])
    chatStore.cleanup(chatId)
  })
})
