import { describe, expect, it } from "vitest"

import { buildLayerHoldTools } from "@/lib/agent/layer-hold"
import type { RoomDoc } from "@/lib/room-access"
import { baseChat, baseDoc, makeHarness } from "@/test/canvas/harness"

/** chat-1's `start_editing` over a canvas harness, as the agent route builds it. */
function chatTools() {
  const h = makeHarness()
  const room = {
    roomId: "room-1",
    readDoc: async (fn) => fn(h.collections),
    mutateDoc: async (fn) => fn(h.collections),
  } as RoomDoc
  h.collections.chatSessions.set(
    "chat-1",
    baseChat("chat-1", { label: "Mine", isStreaming: true })
  )
  h.collections.chatSessions.set(
    "chat-2",
    baseChat("chat-2", { label: "Other" })
  )
  const { start_editing } = buildLayerHoldTools({ room, chatId: "chat-1" })
  const startEditing = (layer_id: string) =>
    start_editing.execute!({ layer_id }, {} as never) as Promise<string>
  const mockup = h.ops.createMockup({
    html: "<p>A</p>",
    title: "Receipt",
    width: 400,
    height: 300,
    lastChangedByChatId: "chat-2",
  })!.mockupId
  h.collections.markdownLayers.set("doc-1", baseDoc("doc-1", { title: "Plan" }))
  const working = (chatId: string) =>
    h.collections.chatSessions.get(chatId)?.workingLayers
  return { ...h, startEditing, mockup, working }
}

describe("start_editing (the chat says what it's about to change)", () => {
  it("holds a Mockup before its page is written", async () => {
    const { startEditing, mockup, working } = chatTools()

    expect(await startEditing(mockup)).toBe(
      "You’re changing “Receipt” now; no other chat can change it until your turn ends."
    )
    expect(working("chat-1")).toEqual({ [mockup]: expect.any(Number) })
  })

  it("holds a Document", async () => {
    const { startEditing, working } = chatTools()

    await startEditing("doc-1")

    expect(working("chat-1")).toEqual({ "doc-1": expect.any(Number) })
  })

  it("keeps when the chat first started on it", async () => {
    const { startEditing, mockup, working } = chatTools()
    await startEditing(mockup)
    const first = working("chat-1")?.[mockup]

    await startEditing(mockup)

    expect(working("chat-1")?.[mockup]).toBe(first)
  })

  it("refuses at once while another chat holds it, taking nothing", async () => {
    const { startEditing, mockup, working, collections } = chatTools()
    collections.chatSessions.update("chat-2", {
      isStreaming: true,
      workingLayers: { [mockup]: 1 },
    })

    expect(await startEditing(mockup)).toBe(
      "Other is changing this right now; tell the person and try again later."
    )
    expect(working("chat-1")).toBe(undefined)
  })

  it("names a layer that isn't on the canvas", async () => {
    const { startEditing, working } = chatTools()

    expect(await startEditing("gone")).toBe(
      "There’s no Mockup or Document gone."
    )
    expect(working("chat-1")).toBe(undefined)
  })
})

describe("the hold is the file's (#1883)", () => {
  /** The Mockup with a second view of its file in another Group. */
  function twoViews() {
    const t = chatTools()
    t.collections.iframeLayerGroups.set("group-2", {
      id: "group-2",
      x: 0,
      y: 0,
      members: [{ kind: "markdown-layer", id: "doc-1" }],
    })
    const view = t.ops.addFileView(t.mockup, "group-2")!
    return { ...t, view }
  }

  it("refuses through one view while another chat holds the file through the other", async () => {
    const { startEditing, mockup, view, working, collections } = twoViews()
    collections.chatSessions.update("chat-2", {
      isStreaming: true,
      workingLayers: { [mockup]: 1 },
    })

    expect(await startEditing(view)).toBe(
      "Other is changing this right now; tell the person and try again later."
    )
    expect(working("chat-1")).toBe(undefined)
  })

  it("refuses while another chat holds it by a view's id", async () => {
    const { startEditing, mockup, view, collections } = twoViews()
    collections.chatSessions.update("chat-2", {
      isStreaming: true,
      workingLayers: { [view]: 1 },
    })

    expect(await startEditing(mockup)).toContain("Other is changing this")
  })

  it("records the file, whichever view it was named by", async () => {
    const { startEditing, mockup, view, working } = twoViews()

    await startEditing(view)

    expect(working("chat-1")).toEqual({ [mockup]: expect.any(Number) })
  })
})
