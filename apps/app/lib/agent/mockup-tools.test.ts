import { describe, expect, it } from "vitest"

import { buildMockupTools, MAX_MOCKUP_HTML } from "@/lib/agent/mockup-tools"
import { createCanvasOps } from "@/lib/canvas/ops"
import { memoryFileStore } from "@/lib/files/store"
import { MOCKUP_INDEX, mockupFolderPrefix } from "@/lib/mockup-folder"
import { mockupFolderOn } from "@/lib/mockup-folder-server"
import type { RoomDoc } from "@/lib/room-access"
import {
  baseBranch,
  baseChat,
  baseLayer,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

/** A chat's Mockup tools over a canvas harness, as the agent route builds them. */
function chatTools(chatId = "chat-1", senderPage?: () => string | undefined) {
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
  const store = memoryFileStore()
  const tools = buildMockupTools({
    room,
    chatId,
    store,
    ...(senderPage ? { senderPage: async () => senderPage() } : {}),
  })
  const run = <K extends keyof typeof tools>(
    name: K,
    input: Parameters<NonNullable<(typeof tools)[K]["execute"]>>[0]
  ) => tools[name].execute!(input as never, {} as never) as Promise<string>
  const folder = mockupFolderOn(room, store)
  /** A Mockup's page, as its folder's index.html holds it (#1886). */
  const pageOf = async (id: string) => (await folder.page(id))?.html ?? ""
  /**
   * A Mockup another chat or a person made, as Canvas Operations make it,
   * with `html` already in its folder.
   */
  const createMockup = (
    spec: Parameters<typeof h.ops.createMockup>[0] & { html?: string }
  ) => {
    const { html, ...rest } = spec
    const made = h.ops.createMockup(rest)
    if (made && html) {
      void store.put(
        mockupFolderPrefix(room.roomId, made.mockupId) + MOCKUP_INDEX,
        new TextEncoder().encode(html),
        "text/html"
      )
      h.collections.mockupLayers.update(made.mockupId, { revision: 1 })
    }
    return made
  }
  return {
    ...h,
    ops: { ...h.ops, createMockup },
    store,
    folder,
    tools,
    run,
    pageOf,
  }
}

const idIn = (out: string) => /id ([^)]+)\)/.exec(out)?.[1] ?? ""

describe("create_mockup", () => {
  it("draws the page on the canvas, owned by the chat", async () => {
    const { run, pageOf, collections } = chatTools()

    const out = await run("create_mockup", {
      place: true,
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
    expect(await pageOf(mockupId)).toBe("<h1>A</h1>")
  })

  it("lands beside the chat’s Workspace frames when it has no Mockups yet", async () => {
    const { run, collections } = chatTools()
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "frame-1" }])

    const mockupId = idIn(
      await run("create_mockup", {
        place: true,
        title: "Option A",
        html: "<p>A</p>",
      })
    )

    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "frame-1" },
      { kind: "mockup-layer", id: mockupId },
    ])
  })

  it("lands beside the chat’s latest Mockup", async () => {
    const { run, collections } = chatTools()
    const first = idIn(
      await run("create_mockup", {
        place: true,
        title: "Option A",
        html: "<p>A</p>",
      })
    )
    const second = idIn(
      await run("create_mockup", {
        place: true,
        title: "Option B",
        html: "<p>B</p>",
      })
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
    const { run, pageOf, collections } = chatTools()
    const mockupId = idIn(
      await run("create_mockup", {
        place: true,
        title: "Option A",
        html: "<p>A</p>",
      })
    )

    const out = await run("update_mockup", {
      mockup_id: mockupId,
      html: "<p>A2</p>",
      title: "Option A2",
    })

    expect(out).toBe(`Updated Mockup ${mockupId}.`)
    expect(await pageOf(mockupId)).toBe("<p>A2</p>")
    expect(collections.mockupLayers.get(mockupId)?.title).toBe("Option A2")
  })

  it("fills a Mockup a person drew and sent to this chat (#1359)", async () => {
    const { run, pageOf, collections, ops } = chatTools()
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
    expect(await pageOf("drawn-1")).toBe("<p>Cart</p>")
    // Where and how big it was drawn stays as is.
    expect(collections.mockupLayers.get("drawn-1")).toMatchObject({
      title: "Empty cart",
      width: 390,
      height: 844,
    })
  })

  it("changes a Mockup another chat made, and records this chat (#1724)", async () => {
    const { run, pageOf, ops, collections } = chatTools()
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
    expect(await pageOf(mockupId)).toBe("<p>mine</p>")
    expect(collections.mockupLayers.get(mockupId)?.lastChangedByChatId).toBe(
      "chat-1"
    )
  })

  it("changes a Mockup made by hand or from before #1724", async () => {
    const { run, pageOf, ops, collections } = chatTools()
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
    expect(await pageOf(old)).toBe("<p>new</p>")
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
      await run("create_mockup", {
        place: true,
        title: "Take 1",
        html: "<p>1</p>",
      })
    )
    const b = idIn(
      await run("create_mockup", {
        place: true,
        title: "Take 2",
        html: "<p>2</p>",
      })
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
      "No Mockup was changed last by this chat. Pass a mockup_id to read any Mockup."
    )
  })

  it("returns a Mockup’s title and whole page", async () => {
    const { run } = chatTools()
    const id = idIn(
      await run("create_mockup", {
        place: true,
        title: "Take 2",
        html: "<h1>Two</h1>",
      })
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
    const { run, pageOf, ops, collections } = chatTools()
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
    expect(await pageOf(mockupId)).toBe("<p>theirs</p>")
    expect(collections.mockupLayers.get(mockupId)?.lastChangedByChatId).toBe(
      "chat-2"
    )
    expect(collections.chatSessions.get("chat-1")?.workingLayers).toBe(
      undefined
    )
  })

  it("lets any chat change it once the holder’s turn ends", async () => {
    const { run, pageOf, ops, collections } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
    })!
    heldByOther(collections, mockupId)
    collections.chatSessions.update("chat-2", { isStreaming: false })

    await run("update_mockup", { mockup_id: mockupId, html: "<p>mine</p>" })

    expect(await pageOf(mockupId)).toBe("<p>mine</p>")
  })

  it("holds what this chat creates and changes, and keeps changing it", async () => {
    const { run, pageOf, collections } = chatTools()
    collections.chatSessions.update("chat-1", { isStreaming: true })
    const mockupId = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
      })
    )
    const started =
      collections.chatSessions.get("chat-1")?.workingLayers?.[mockupId]
    expect(started).toEqual(expect.any(Number))

    await run("update_mockup", { mockup_id: mockupId, html: "<p>A2</p>" })

    expect(await pageOf(mockupId)).toBe("<p>A2</p>")
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
    const { run, pageOf, ops, collections } = chatTools()
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
    expect(await pageOf(mockupId)).toBe("<p>theirs</p>")
  })
})

describe("pages (#1842)", () => {
  /** A canvas with "Page 1" and "Explorations", the sender on `page`. */
  function onPages() {
    const sender = { page: "page-2" as string | undefined }
    const t = chatTools("chat-1", () => sender.page)
    t.collections.pages.set("page-1", {
      id: "page-1",
      name: "Page 1",
      order: 0,
    })
    t.collections.pages.set("page-2", {
      id: "page-2",
      name: "Explorations",
      order: 1,
    })
    const pageOf = (mockupId: string) =>
      t.collections.iframeLayerGroups
        .toArray()
        .find((g) => g.members.some((m) => m.id === mockupId))?.pageId
    return { ...t, sender, pageOf }
  }

  it("lands on the sender’s page", async () => {
    const { run, pageOf } = onPages()

    const id = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
      })
    )

    expect(pageOf(id)).toBe("page-2")
  })

  it("lands on the first page when no message names one", async () => {
    const { run, pageOf, sender } = onPages()
    sender.page = undefined

    const id = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
      })
    )

    expect(pageOf(id)).toBe("page-1")
  })

  it("lands on a page it names, by name or id", async () => {
    const { run, pageOf } = onPages()

    const byName = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
        page: "page 1",
      })
    )
    const byId = idIn(
      await run("create_mockup", {
        place: true,
        title: "B",
        html: "<p>B</p>",
        page: "page-2",
      })
    )

    expect(pageOf(byName)).toBe("page-1")
    expect(pageOf(byId)).toBe("page-2")
  })

  it("lists the pages for a name no page has, and draws nothing", async () => {
    const { run, collections } = onPages()

    const out = await run("create_mockup", {
      place: true,
      title: "A",
      html: "<p>A</p>",
      page: "Archive",
    })

    expect(out).toContain('no page "Archive"')
    expect(out).toContain('"Page 1" (page-1), "Explorations" (page-2)')
    expect(collections.mockupLayers.toArray()).toEqual([])
  })

  it("sits beside the chat’s Mockups and frames only on that page", async () => {
    const { run, collections, pageOf, sender } = onPages()
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "frame-1" }])
    sender.page = "page-1"
    const first = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
      })
    )
    sender.page = "page-2"

    const second = idIn(
      await run("create_mockup", {
        place: true,
        title: "B",
        html: "<p>B</p>",
      })
    )
    const third = idIn(
      await run("create_mockup", {
        place: true,
        title: "C",
        html: "<p>C</p>",
      })
    )

    expect(collections.iframeLayerGroups.get("group-1")?.members).toEqual([
      { kind: "iframe-layer", id: "frame-1" },
      { kind: "mockup-layer", id: first },
    ])
    expect(pageOf(second)).toBe("page-2")
    const onSecondPage = collections.iframeLayerGroups
      .toArray()
      .filter((g) => g.pageId === "page-2")
    expect(onSecondPage).toHaveLength(1)
    expect(onSecondPage[0]!.members.map((m) => m.id)).toEqual([second, third])
  })

  it("reads say which page a Mockup is on", async () => {
    const { run } = onPages()
    const id = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
      })
    )

    expect(await run("read_mockup", {})).toContain(
      `- ${id}: A (page "Explorations")`
    )
    expect(await run("read_mockup", { mockup_id: id })).toMatch(
      /^Page: "Explorations"\n\n# A\n/
    )
  })

  it("says nothing of pages on a one-page canvas", async () => {
    const { run } = chatTools()
    const id = idIn(
      await run("create_mockup", {
        place: true,
        title: "A",
        html: "<p>A</p>",
      })
    )

    expect(await run("read_mockup", { mockup_id: id })).toMatch(/^# A\n/)
  })
})

describe("files and views (#1883)", () => {
  it("updates the file through any view, so both views show the new page", async () => {
    const { run, pageOf, collections } = chatTools()
    const mockupId = idIn(
      await run("create_mockup", {
        place: true,
        title: "Option A",
        html: "<h1>A</h1>",
      })
    )
    const groupId = collections.iframeLayerGroups.toArray()[0]!.id
    const viewId = createCanvasOps(collections).addFileView(mockupId, groupId)!

    await run("update_mockup", { mockup_id: viewId, html: "<h1>B</h1>" })

    expect(await pageOf(mockupId)).toBe("<h1>B</h1>")
    const read = await run("read_mockup", { mockup_id: viewId })
    expect(read).toContain("<h1>B</h1>")
    expect(collections.mockupLayers.get(viewId)?.lastChangedByChatId).toBe(
      "chat-1"
    )
  })
})

describe("Mockups off the canvas (#1885)", () => {
  it("makes a Mockup with no view when it isn’t placed", async () => {
    const { run, pageOf, collections } = chatTools()

    const out = await run("create_mockup", {
      place: false,
      title: "Options",
      html: "<h1>Pick</h1>",
    })

    const fileId = idIn(out)
    expect(out).toContain("not on the canvas")
    expect(collections.mockupLayers.toArray()).toEqual([])
    expect(collections.iframeLayerGroups.toArray()).toEqual([])
    expect(collections.layerFiles.get(fileId)).toMatchObject({
      kind: "mockup",
      title: "Options",
      lastChangedByChatId: "chat-1",
    })
    expect(await pageOf(fileId)).toBe("<h1>Pick</h1>")
  })

  it("updates and reads a Mockup with no view, and lists it as off the canvas", async () => {
    const { run, pageOf } = chatTools()
    const fileId = idIn(
      await run("create_mockup", { place: false, title: "Options", html: "a" })
    )

    expect(
      await run("update_mockup", { mockup_id: fileId, html: "<p>b</p>" })
    ).toBe(`Updated Mockup ${fileId}.`)
    expect(await pageOf(fileId)).toBe("<p>b</p>")
    expect(await run("read_mockup", { mockup_id: fileId })).toContain(
      "<p>b</p>"
    )
    expect(await run("read_mockup", {})).toContain(
      `- ${fileId}: Options (not on the canvas)`
    )
  })
})

describe("Mockup folders (#1886)", () => {
  it("puts the page in the folder and bumps the revision on every write", async () => {
    const { run, store, collections } = chatTools()
    const id = idIn(
      await run("create_mockup", { place: true, title: "A", html: "<p>A</p>" })
    )
    expect(collections.mockupLayers.get(id)?.revision).toBe(1)
    expect(store.keys()).toEqual([`canvas/room-1/mockups/${id}/index.html`])

    await run("update_mockup", { mockup_id: id, html: "<p>A2</p>" })
    expect(collections.mockupLayers.get(id)?.revision).toBe(2)
    // A rename alone leaves the folder be.
    await run("update_mockup", { mockup_id: id, title: "A2" })
    expect(collections.mockupLayers.get(id)?.revision).toBe(2)
  })

  it("writes, reads and removes files beside the page", async () => {
    const { run, collections } = chatTools()
    const id = idIn(
      await run("create_mockup", {
        place: true,
        title: "Explore",
        html: '<script src="data.js"></script>',
      })
    )

    expect(
      await run("write_mockup_file", {
        mockup_id: id,
        path: "data.js",
        content: "const DATA = 1",
      })
    ).toBe(`Wrote "data.js" (14 B) in Mockup ${id}.`)
    expect(collections.mockupLayers.get(id)?.revision).toBe(2)
    expect(await run("read_mockup", { mockup_id: id, path: "data.js" })).toBe(
      "const DATA = 1"
    )
    expect(await run("read_mockup", { mockup_id: id })).toContain(
      "Other files in its folder (read one with path):\n- data.js (14 B)"
    )

    await run("write_mockup_file", {
      mockup_id: id,
      path: "data.js",
      delete: true,
    })
    expect(await run("read_mockup", { mockup_id: id, path: "data.js" })).toBe(
      `Mockup ${id} has no file at "data.js".`
    )
    expect(collections.mockupLayers.get(id)?.revision).toBe(3)
  })

  it("copies a capture from the canvas’s saved files", async () => {
    const { run, store, collections } = chatTools()
    collections.files.set("file-1", {
      id: "file-1",
      path: "screenshots/home.png",
      kind: "file",
      size: 3,
      mediaType: "image/png",
      addedBy: "agent",
      addedById: "chat-1",
      blobKey: "canvas/room-1/file-1",
      createdAt: 1,
      updatedAt: 1,
    })
    await store.put("canvas/room-1/file-1", new Uint8Array([1, 2, 3]), "")
    const id = idIn(
      await run("create_mockup", { place: true, title: "A", html: "<p/>" })
    )

    await run("write_mockup_file", {
      mockup_id: id,
      path: "captures/home.png",
      from_file: "screenshots/home.png",
    })

    expect(
      await store.get(`canvas/room-1/mockups/${id}/captures/home.png`)
    ).toEqual(new Uint8Array([1, 2, 3]))
    expect(
      await run("read_mockup", { mockup_id: id, path: "captures/home.png" })
    ).toBe(
      `"captures/home.png" is a 3 B image/png file, which the page loads by its path.`
    )
  })

  it("refuses a write past the folder’s size limit, writing nothing", async () => {
    const { run, store, collections } = chatTools()
    const id = idIn(
      await run("create_mockup", { place: true, title: "A", html: "<p/>" })
    )
    await store.put(
      `canvas/room-1/mockups/${id}/big.bin`,
      new Uint8Array(25 * 1024 * 1024),
      ""
    )

    const out = await run("write_mockup_file", {
      mockup_id: id,
      path: "data.js",
      content: "const DATA = 1",
    })

    expect(out).toContain("the most it can hold is 26214400 (25 MB)")
    expect(await store.get(`canvas/room-1/mockups/${id}/data.js`)).toBeNull()
    expect(collections.mockupLayers.get(id)?.revision).toBe(1)
  })

  it("refuses another chat’s write while it holds the Mockup", async () => {
    const { run, ops, collections, store } = chatTools()
    const { mockupId } = ops.createMockup({
      html: "<p>theirs</p>",
      title: "Theirs",
      width: 400,
      height: 300,
    })!
    collections.chatSessions.update("chat-2", {
      isStreaming: true,
      workingLayers: { [mockupId]: 1 },
    })

    const out = await run("write_mockup_file", {
      mockup_id: mockupId,
      path: "data.js",
      content: "x",
    })

    expect(out).toContain("Other is changing this right now")
    expect(
      await store.get(`canvas/room-1/mockups/${mockupId}/data.js`)
    ).toBeNull()
  })

  it("asks for exactly one of content, from_file or delete", async () => {
    const { run } = chatTools()
    const id = idIn(
      await run("create_mockup", { place: true, title: "A", html: "<p/>" })
    )
    expect(
      await run("write_mockup_file", { mockup_id: id, path: "a.js" })
    ).toBe("Pass exactly one of content, from_file or delete.")
  })
})
