import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore } from "./chat-store"
import { toolCallStart, toolCallUpdate } from "./agent/acp/schema"
import { viewRequests, type ViewRequest } from "./canvas/view-requests"

let seq = 0
const nextId = () => `evt_view_${++seq}`
const newChat = () => `chat_view_${++seq}`

/** A Coordinator turn that calls `show_on_canvas` on `ids` and finishes. */
function showTurn(chatId: string, title: string, ids: string[]) {
  const toolCallId = `call_${++seq}`
  for (const update of [
    toolCallStart({ toolCallId, title, rawInput: { ids } }),
    toolCallUpdate({ toolCallId, status: "completed" }),
  ]) {
    chatStore.handleBroadcastEvent({
      type: "chat-acp-update",
      chatId,
      id: nextId(),
      update,
    })
  }
  chatStore.handleBroadcastEvent({
    type: "chat-stream-end",
    chatId,
    id: nextId(),
  })
}

function listen() {
  const seen: ViewRequest[] = []
  const stop = viewRequests.subscribe((r) => seen.push(r))
  return { seen, stop }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("chat-store — the Coordinator's show_on_canvas", () => {
  it("moves the view of the member who asked, once", async () => {
    const chatId = newChat()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => null })
    )
    const { seen, stop } = listen()

    await chatStore.sendMessage({
      roomId: "room",
      chatId,
      message: "Zoom to the cart",
      target: { kind: "room" },
    })
    chatStore.handleBroadcastEvent({
      type: "chat-stream-start",
      chatId,
      id: nextId(),
    })
    // A desktop harness names it under its MCP server.
    showTurn(chatId, "mcp__screenplay__show_on_canvas", ["f-cart"])

    expect(seen).toEqual([{ chatId, ids: ["f-cart"] }])
    stop()
    chatStore.cleanup(chatId)
  })

  it("leaves everyone else's view alone", () => {
    const chatId = newChat()
    const { seen, stop } = listen()

    chatStore.handleBroadcastEvent({
      type: "chat-stream-start",
      chatId,
      id: nextId(),
    })
    showTurn(chatId, "show_on_canvas", [])

    expect(seen).toEqual([])
    stop()
    chatStore.cleanup(chatId)
  })
})
