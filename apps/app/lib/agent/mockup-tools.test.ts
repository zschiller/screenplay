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
      ownerChatId: "chat-1",
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
    // What the ask card writes: an empty page, owned by the answering chat.
    ops.createMockup({
      id: "drawn-1",
      html: "",
      title: "",
      width: 390,
      height: 844,
      ownerChatId: "chat-1",
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

  it("refuses a Mockup another chat made", async () => {
    const { run, doc, ops } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      ownerChatId: "chat-2",
    })!

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>mine</p>",
    })

    expect(out).toContain("made by another chat")
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>theirs</p>")
  })

  it("lets the chat change a Mockup whose chat was deleted, and claims it", async () => {
    const { run, doc, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>orphan</p>",
      title: "Orphan",
      width: 400,
      height: 300,
      ownerChatId: "deleted-chat",
    })!

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>mine now</p>",
    })

    expect(out).toBe(`Updated Mockup ${mockupId}.`)
    expect(mockupHtml(doc, mockupId).toString()).toBe("<p>mine now</p>")
    expect(collections.mockupLayers.get(mockupId)?.ownerChatId).toBe("chat-1")
  })

  it("reports a missing Mockup", async () => {
    const { run } = chatTools()
    expect(
      await run("update_mockup", { mockup_id: "gone", html: "<p>A</p>" })
    ).toBe("There’s no Mockup gone.")
  })
})

describe("read_mockup", () => {
  it("lists the chat’s own Mockups", async () => {
    const { run, ops } = chatTools()
    const a = idIn(
      await run("create_mockup", { title: "Take 1", html: "<p>1</p>" })
    )
    const b = idIn(
      await run("create_mockup", { title: "Take 2", html: "<p>2</p>" })
    )
    ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      ownerChatId: "chat-2",
    })

    expect(await run("read_mockup", {})).toBe(
      ["Your Mockups:", `- ${a}: Take 1`, `- ${b}: Take 2`].join("\n")
    )
  })

  it("says when the chat has no Mockups", async () => {
    const { run } = chatTools()
    expect(await run("read_mockup", {})).toBe(
      "This chat hasn’t made any Mockups."
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

  it("reads a Mockup another chat made, and says so", async () => {
    const { run, ops } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
      ownerChatId: "chat-2",
    })!

    const out = await run("read_mockup", { mockup_id: mockupId })

    expect(out).toContain("# Theirs (made by another chat)")
    expect(out).toContain("<p>theirs</p>")
  })

  it("says a Mockup whose chat was deleted is the chat’s to change", async () => {
    const { run, ops } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>orphan</p>",
      title: "Orphan",
      width: 400,
      height: 300,
      ownerChatId: "deleted-chat",
    })!

    expect(await run("read_mockup", { mockup_id: mockupId })).toContain(
      "# Orphan (its chat was deleted; you can change it)"
    )
  })

  it("reports a missing Mockup", async () => {
    const { run } = chatTools()
    expect(await run("read_mockup", { mockup_id: "gone" })).toBe(
      "There’s no Mockup gone."
    )
  })
})
