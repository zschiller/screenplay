import { beforeEach, describe, expect, it, vi } from "vitest"

const openRoomForViewer = vi.fn()
const chatRoomId = vi.fn()
const loadChatTranscript = vi.fn()

vi.mock("@/lib/room-access", () => ({
  openRoomForViewer: (...args: unknown[]) => openRoomForViewer(...args),
  chatRoomId: (...args: unknown[]) => chatRoomId(...args),
}))
vi.mock("@/lib/agent/history-load", () => ({
  loadChatTranscript: (...args: unknown[]) => loadChatTranscript(...args),
}))

const { GET } = await import("./route")

function get(chatId?: string) {
  const query = chatId ? `?chatId=${chatId}` : ""
  return GET(new Request(`http://viewer.test/s/room-1/key/history${query}`), {
    params: Promise.resolve({ roomId: "room-1", key: "key" }),
  })
}

describe("a viewer's chat transcript", () => {
  beforeEach(() => {
    openRoomForViewer.mockReset().mockResolvedValue({ roomId: "room-1" })
    chatRoomId.mockReset().mockResolvedValue("room-1")
    loadChatTranscript.mockReset().mockResolvedValue([{ role: "user" }])
  })

  it("reads a chat of the linked canvas", async () => {
    const res = await get("chat-1")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ role: "user" }])
    expect(openRoomForViewer).toHaveBeenCalledWith("room-1", "key")
    expect(loadChatTranscript).toHaveBeenCalledWith("chat-1")
  })

  it("finds nothing without the canvas link", async () => {
    openRoomForViewer.mockResolvedValue(null)
    expect((await get("chat-1")).status).toBe(404)
    expect(loadChatTranscript).not.toHaveBeenCalled()
  })

  it("finds nothing for another canvas's chat", async () => {
    chatRoomId.mockResolvedValue("room-2")
    expect((await get("chat-1")).status).toBe(404)
    expect(loadChatTranscript).not.toHaveBeenCalled()
  })

  it("answers an unrecorded chat with an empty transcript", async () => {
    chatRoomId.mockResolvedValue(null)
    expect(await (await get("chat-1")).json()).toEqual([])
    expect(await (await get()).json()).toEqual([])
    expect(loadChatTranscript).not.toHaveBeenCalled()
  })
})
