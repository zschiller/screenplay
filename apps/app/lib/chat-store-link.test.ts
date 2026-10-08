import { afterEach, describe, expect, it, vi } from "vitest"
import { chatStore, readChatsThroughLink } from "./chat-store"

let seq = 0
const newChat = () => `chat_link_${++seq}`

function stubFetch() {
  const fetch = vi.fn(async () => new Response("[]"))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => {
  readChatsThroughLink(null)
  vi.unstubAllGlobals()
})

describe("chat history on a viewer's page (#1933)", () => {
  it("reads a chat through the canvas link", async () => {
    const fetch = stubFetch()
    readChatsThroughLink({ roomId: "room 1", shareKey: "key" })
    await chatStore.loadHistory("chat 1")
    expect(fetch).toHaveBeenCalledWith(
      "/s/room%201/key/history?chatId=chat%201"
    )
  })

  it("reads the host's route when there's no link", async () => {
    const fetch = stubFetch()
    const chatId = newChat()
    await chatStore.loadHistory(chatId)
    expect(fetch).toHaveBeenCalledWith(`/api/agent/history?chatId=${chatId}`)
  })
})
