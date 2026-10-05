import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore } from "./chat-store"
import {
  textBlock,
  toolCallStart,
  toolCallUpdate,
  type SessionUpdate,
} from "./agent/acp/schema"

let seq = 0
const nextId = () => `evt_${++seq}`

/** A chat partway through a turn. */
function running() {
  const chatId = `chat_working_${++seq}`
  chatStore.handleBroadcastEvent({
    type: "chat-stream-start",
    chatId,
    id: nextId(),
  })
  return chatId
}

function update(chatId: string, u: SessionUpdate) {
  chatStore.handleBroadcastEvent({
    type: "chat-acp-update",
    chatId,
    id: nextId(),
    update: u,
  })
}

const working = (chatId: string) =>
  Object.keys(chatStore.getSnapshot(chatId).workingLayers)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat-store — the layers a turn is changing (#1725)", () => {
  it("adds a layer as soon as an update call’s arguments name it", () => {
    const chatId = running()
    update(chatId, toolCallStart({ toolCallId: "t1", title: "update_mockup" }))
    expect(working(chatId)).toEqual([])

    update(
      chatId,
      toolCallUpdate({
        toolCallId: "t1",
        status: "in_progress",
        rawInput: { mockup_id: "mock-1", html: "<p>…" },
      })
    )
    update(
      chatId,
      toolCallStart({
        toolCallId: "t2",
        title: "mcp__screenplay__append_to_document_body",
        rawInput: { document_id: "doc-1", content: "More" },
      })
    )

    expect(working(chatId)).toEqual(["mock-1", "doc-1"])
    chatStore.cleanup(chatId)
  })

  it("adds a new layer when its create returns the id", () => {
    const chatId = running()
    update(
      chatId,
      toolCallStart({
        toolCallId: "t1",
        title: "create_mockup",
        rawInput: { title: "A", html: "<p>A</p>" },
      })
    )
    expect(working(chatId)).toEqual([])

    update(
      chatId,
      toolCallUpdate({
        toolCallId: "t1",
        status: "completed",
        content: [
          {
            type: "content",
            content: textBlock('Created Mockup "A" (id mock-9).'),
          },
        ],
      })
    )

    expect(working(chatId)).toEqual(["mock-9"])
    chatStore.cleanup(chatId)
  })

  it("keeps when it first started on a layer", () => {
    const chatId = running()
    const input = { document_id: "doc-1", title: "Plan" }
    update(
      chatId,
      toolCallStart({
        toolCallId: "t1",
        title: "set_document_title",
        rawInput: input,
      })
    )
    const first = chatStore.getSnapshot(chatId).workingLayers["doc-1"]
    update(
      chatId,
      toolCallStart({
        toolCallId: "t2",
        title: "set_document_title",
        rawInput: input,
      })
    )
    expect(chatStore.getSnapshot(chatId).workingLayers["doc-1"]).toBe(first)
    chatStore.cleanup(chatId)
  })

  it("ignores calls that change no Mockup or Document", () => {
    const chatId = running()
    update(
      chatId,
      toolCallStart({
        toolCallId: "t1",
        title: "read_mockup",
        rawInput: { mockup_id: "mock-1" },
      })
    )
    update(
      chatId,
      toolCallStart({
        toolCallId: "t2",
        title: "Edit",
        rawInput: { document_id: "doc-1" },
      })
    )
    expect(working(chatId)).toEqual([])
    chatStore.cleanup(chatId)
  })

  it("clears the list when the turn ends, including a healed stale one", () => {
    const chatId = running()
    update(
      chatId,
      toolCallStart({
        toolCallId: "t1",
        title: "update_mockup",
        rawInput: { mockup_id: "mock-1" },
      })
    )
    // A turn's end, a stop and the heal of a dead stream all arrive as the
    // same end signal.
    chatStore.handleBroadcastEvent({
      type: "chat-stream-end",
      chatId,
      id: nextId(),
    })
    expect(working(chatId)).toEqual([])
    chatStore.cleanup(chatId)
  })

  it("clears the list when a stop can’t reach the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline")
      })
    )
    const chatId = running()
    update(
      chatId,
      toolCallStart({
        toolCallId: "t1",
        title: "update_mockup",
        rawInput: { mockup_id: "mock-1" },
      })
    )

    await chatStore.stopMessage("room-1", chatId)

    expect(chatStore.getSnapshot(chatId).isStreaming).toBe(false)
    expect(working(chatId)).toEqual([])
    chatStore.cleanup(chatId)
  })

  it("adds nothing outside a turn", () => {
    const chatId = `chat_working_${++seq}`
    update(
      chatId,
      toolCallStart({
        toolCallId: "t1",
        title: "update_mockup",
        rawInput: { mockup_id: "mock-1" },
      })
    )
    expect(working(chatId)).toEqual([])
    chatStore.cleanup(chatId)
  })
})
