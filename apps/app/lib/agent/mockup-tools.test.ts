import { describe, expect, it } from "vitest"

import { buildMockupTools, MAX_MOCKUP_HTML } from "@/lib/agent/mockup-tools"
import type { RoomDoc } from "@/lib/room-access"
import { mockupHtml } from "@/lib/yjs/mockup-html"
import {
  baseBranch,
  baseChat,
  baseLayer,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

/** A chat's Mockup tools over a canvas harness, as the agent route builds them. */
function chatTools(chatId = "chat-1") {
  const h = makeHarness()
  const room = {
    roomId: "room-1",
    readDoc: async (fn) => fn(h.collections),
    mutateDoc: async (fn) => fn(h.collections),
  } as RoomDoc
  h.collections.branches.set("ws-1", baseBranch("ws-1"))
  h.collections.chatSessions.set(
    "chat-1",
    baseChat("chat-1", { branchId: "ws-1", label: "Empty cart" })
  )
  h.collections.chatSessions.set(
    "chat-2",
    baseChat("chat-2", { label: "Other" })
  )
  const tools = buildMockupTools({ room, chatId })
  const run = <K extends keyof typeof tools>(
    name: K,
    input: Parameters<NonNullable<(typeof tools)[K]["execute"]>>[0]
  ) => tools[name].execute!(input as never, {} as never) as Promise<string>
  return { ...h, tools, run }
}

const idIn = (out: string) => /id ([^)]+)\)/.exec(out)?.[1] ?? ""

describe("create_mockup", () => {
  it("draws the page on the canvas, owned by the chat", async () => {
    const { run, doc, collections } = chatTools()

    const out = await run("create_mockup", {
      title: "Option A",
      html: "<h1>A</h1>",
    })

    const mockupId = idIn(out)
    expect(out).toContain('Created Mockup "Option A"')
    expect(collections.mockupLayers.get(mockupId)).toMatchObject({
      title: "Option A",
      lastChangedByChatId: "chat-1",
      width: 1280,
      height: 800,
    })
    expect(mockupHtml(doc, mockupId).toString()).toBe("<h1>A</h1>")
  })

  it("lands beside the chat’s Workspace frames when it has no Mockups yet", async () => {
    const { run, collections } = chatTools()
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "frame-1" }])

    const mockupId = idIn(
      await run("create_mockup", { title: "Option A", html: "<p>A</p>" })
    )

    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "frame-1" },
      { kind: "mockup-layer", id: mockupId },
    ])
  })

  it("lands beside the chat’s latest Mockup", async () => {
    const { run, collections } = chatTools()
    const first = idIn(
      await run("create_mockup", { title: "Option A", html: "<p>A</p>" })
    )
    const second = idIn(
      await run("create_mockup", { title: "Option B", html: "<p>B</p>" })
    )

    const groups = collections.iframeLayerGroups.toArray()
    expect(groups).toHaveLength(1)
    expect(groups[0]!.members).toEqual([
      { kind: "mockup-layer", id: first },
      { kind: "mockup-layer", id: second },
    ])
  })

  it("rejects a page too large for the Room doc", () => {
    const { tools } = chatTools()
    const schema = tools.create_mockup.inputSchema as unknown as {
      safeParse(v: unknown): { success: boolean }
    }
    expect(
      schema.safeParse({ title: "Big", html: "x".repeat(MAX_MOCKUP_HTML + 1) })
        .success
    ).toBe(false)
  })
})

describe("update_mockup", () => {
  it("rewrites the chat’s own Mockup in place", async () => {
    const { run, doc, collections } = chatTools()
    const mockupId = idIn(
      await run("create_mockup", { title: "Option A", html: "<p>A</p>" })
    )

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>A2</p>",
      title: "Option A2",
    })

    expect(out).toBe(`Updated Mockup ${mockupId}.`)
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>A2</p>")
    expect(collections.mockupLayers.get(mockupId)?.title).toBe("Option A2")
  })

  it("fills a Mockup a person drew and sent to this chat (#1359)", async () => {
    const { run, doc, collections, ops } = chatTools()
    // What the ask card writes: an empty page, last changed by the answering
    // chat.
    ops.createMockup({
      id: "drawn-1",
      html: "",
      title: "",
      width: 390,
      height: 844,
      lastChangedByChatId: "chat-1",
      anchor: { x: 40, y: 60 },
    })

    const out = await run("update_mockup", {
      mockup_id: "drawn-1",
      html: "<p>Cart</p>",
      title: "Empty cart",
    })

    expect(out).toBe("Updated Mockup drawn-1.")
    expect(mockupHtml(doc, "drawn-1").toString()).toBe("<p>Cart</p>")
    // Where and how big it was drawn stays as is.
    expect(collections.mockupLayers.get("drawn-1")).toMatchObject({
      title: "Empty cart",
      width: 390,
      height: 844,
    })
  })

  it("changes a Mockup another chat made, and records this chat (#1724)", async () => {
    const { run, doc, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>mine</p>",
    })

    expect(out).toBe(`Updated Mockup ${mockupId}.`)
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>mine</p>")
    expect(collections.mockupLayers.get(mockupId)?.lastChangedByChatId).toBe(
      "chat-1"
    )
  })

  it("changes a Mockup made by hand or from before #1724", async () => {
    const { run, doc, ops, collections } = chatTools()
    const { mockupId: hand } = ops.createMockup({
      html: "<p>hand</p>",
      title: "Hand",
      width: 400,
      height: 300,
    })!
    const { mockupId: old } = ops.createMockup({
      html: "<p>old</p>",
      title: "Old",
      width: 400,
      height: 300,
    })!
    collections.mockupLayers.update(old, { ownerChatId: "chat-2" })

    await run("update_mockup", { mockup_id: hand, title: "Hand 2" })
    await run("update_mockup", { mockup_id: old, html: "<p>new</p>" })

    expect(collections.mockupLayers.get(hand)).toMatchObject({
      title: "Hand 2",
      lastChangedByChatId: "chat-1",
    })
    expect(mockupHtml(doc, old).toString()).toBe("<p>new</p>")
    expect(collections.mockupLayers.get(old)?.lastChangedByChatId).toBe(
      "chat-1"
    )
  })

  it("reports a missing Mockup", async () => {
    const { run } = chatTools()
    expect(
      await run("update_mockup", { mockup_id: "gone", html: "<p>A</p>" })
    ).toBe("There’s no Mockup gone.")
  })
})

describe("read_mockup", () => {
  it("lists the Mockups this chat changed last", async () => {
    const { run, ops } = chatTools()
    const a = idIn(
      await run("create_mockup", { title: "Take 1", html: "<p>1</p>" })
    )
    const b = idIn(
      await run("create_mockup", { title: "Take 2", html: "<p>2</p>" })
    )
    const { mockupId: theirs } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!
    const { mockupId: taken } = ops.createMockup({
      html: "<p>taken</p>",
      title: "Taken",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!
    await run("update_mockup", { mockup_id: taken, title: "Taken over" })

    const out = await run("read_mockup", {})
    expect(out).toBe(
      [
        "Mockups this chat changed last:",
        `- ${a}: Take 1`,
        `- ${b}: Take 2`,
        `- ${taken}: Taken over`,
      ].join("\n")
    )
    expect(out).not.toContain(theirs)
  })

  it("says when the chat changed no Mockup last", async () => {
    const { run } = chatTools()
    expect(await run("read_mockup", {})).toBe(
      "No Mockup was changed last by this chat. Pass a mockup_id to read any Mockup on the canvas."
    )
  })

  it("returns a Mockup’s title and whole page", async () => {
    const { run } = chatTools()
    const id = idIn(
      await run("create_mockup", { title: "Take 2", html: "<h1>Two</h1>" })
    )

    expect(await run("read_mockup", { mockup_id: id })).toBe(
      ["# Take 2", "", "<h1>Two</h1>"].join("\n")
    )
  })

  it("reads a Mockup another chat made", async () => {
    const { run, ops } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!

    expect(await run("read_mockup", { mockup_id: mockupId })).toBe(
      ["# Theirs", "", "<p>theirs</p>"].join("\n")
    )
  })

  it("reports a missing Mockup", async () => {
    const { run } = chatTools()
    expect(await run("read_mockup", { mockup_id: "gone" })).toBe(
      "There’s no Mockup gone."
    )
  })
})

describe("holding a Mockup (#1725)", () => {
  /** chat-2's running turn is changing `mockupId`. */
  function heldByOther(
    collections: ReturnType<typeof chatTools>["collections"],
    mockupId: string
  ) {
    collections.chatSessions.update("chat-2", {
      isStreaming: true,
      workingLayers: { [mockupId]: 1 },
    })
  }

  it("refuses another chat’s change with the holder’s name", async () => {
    const { run, doc, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!
    heldByOther(collections, mockupId)

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>mine</p>",
    })

    expect(out).toBe(
      "Other is changing this right now; tell the person and try again later."
    )
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>theirs</p>")
    expect(collections.mockupLayers.get(mockupId)?.lastChangedByChatId).toBe(
      "chat-2"
    )
    expect(collections.chatSessions.get("chat-1")?.workingLayers).toBe(
      undefined
    )
  })

  it("lets any chat change it once the holder’s turn ends", async () => {
    const { run, doc, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
    })!
    heldByOther(collections, mockupId)
    collections.chatSessions.update("chat-2", { isStreaming: false })

    await run("update_mockup", { mockup_id: mockupId, html: "<p>mine</p>" })

    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>mine</p>")
  })

  it("holds what this chat creates and changes, and keeps changing it", async () => {
    const { run, doc, collections } = chatTools()
    collections.chatSessions.update("chat-1", { isStreaming: true })
    const mockupId = idIn(
      await run("create_mockup", { title: "A", html: "<p>A</p>" })
    )
    const started =
      collections.chatSessions.get("chat-1")?.workingLayers?.[mockupId]
    expect(started).toEqual(expect.any(Number))

    await run("update_mockup", { mockup_id: mockupId, html: "<p>A2</p>" })

    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>A2</p>")
    expect(collections.chatSessions.get("chat-1")?.workingLayers).toEqual({
      [mockupId]: started,
    })
  })

  it("holds a Mockup this chat reads", async () => {
    const { run, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      lastChangedByChatId: "chat-2",
    })!

    await run("read_mockup", { mockup_id: mockupId })

    expect(
      collections.chatSessions.get("chat-1")?.workingLayers?.[mockupId]
    ).toEqual(expect.any(Number))
    expect(collections.mockupLayers.get(mockupId)?.lastChangedByChatId).toBe(
      "chat-2"
    )
  })

  it("reads a Mockup another chat holds, without taking it", async () => {
    const { run, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
    })!
    heldByOther(collections, mockupId)

    expect(await run("read_mockup", { mockup_id: mockupId })).toBe(
      ["# Theirs", "", "<p>theirs</p>"].join("\n")
    )
    expect(collections.chatSessions.get("chat-1")?.workingLayers).toBe(
      undefined
    )
  })

  it("leaves the earliest holder in charge when two chats list it", async () => {
    const { run, doc, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
    })!
    heldByOther(collections, mockupId)
    collections.chatSessions.update("chat-1", {
      isStreaming: true,
      workingLayers: { [mockupId]: 2 },
    })

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>mine</p>",
    })

    expect(out).toContain("Other is changing this right now")
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>theirs</p>")
  })
})
