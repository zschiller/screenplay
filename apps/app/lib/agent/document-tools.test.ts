import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { buildDocumentTools } from "@/lib/agent/document-tools"
import { buildLayerReadTools } from "@/lib/agent/layer-read-tools"
import type { RoomDoc } from "@/lib/room-access"
import { documentFragment } from "@/lib/yjs/fragment-text"
import {
  baseBranch,
  baseChat,
  baseDoc,
  makeHarness,
} from "@/test/canvas/harness"

/**
 * A chat's Document tools and `read_document` against a bare Room doc, with a
 * Document a person has typed mention pills and marks into.
 */
function setup(senderPage?: () => string | undefined) {
  const { collections } = makeHarness()
  collections.chatSessions.set("chat-1", baseChat("chat-1"))
  collections.branches.set(
    "ws-1",
    baseBranch("ws-1", { title: "Fix the login" })
  )
  collections.markdownLayers.set(
    "doc-1",
    baseDoc("doc-1", { title: "Plan", lastChangedByChatId: "chat-1" })
  )
  collections.markdownLayers.set("doc-2", baseDoc("doc-2", { title: "Notes" }))
  collections.mockupLayers.set("mock-1", {
    id: "mock-1",
    width: 400,
    height: 300,
    title: "Hero",
  })
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async (fn) => fn(collections),
    mutateDoc: async (fn) => fn(collections),
  }
  const tools = {
    ...buildDocumentTools({
      room,
      chatId: "chat-1",
      ...(senderPage ? { senderPage: async () => senderPage() } : {}),
    }),
    ...buildLayerReadTools({ room }),
  }
  const run = (name: keyof typeof tools, input: object) =>
    (
      tools[name] as unknown as {
        execute: (input: object, opts: never) => Promise<string>
      }
    ).execute(input, {} as never)
  const fragment = documentFragment(collections.doc, "doc-1")
  return { collections, run, fragment }
}

/** A mention pill as the editor stores it. */
function mention(kind: string, id: string, label: string): Y.XmlElement {
  const el = new Y.XmlElement("mention")
  el.setAttribute("id", id)
  el.setAttribute("label", label)
  el.setAttribute("kind", kind)
  return el
}

/** Type the title and one paragraph holding a bold word and three pills. */
function typeBody(fragment: Y.XmlFragment) {
  const title = new Y.XmlElement("heading")
  ;(title as Y.XmlElement<{ level: number }>).setAttribute("level", 1)
  title.insert(0, [new Y.XmlText("Plan")])
  const p = new Y.XmlElement("paragraph")
  const bold = new Y.XmlText()
  bold.insert(0, "See ")
  bold.insert(4, "this", { bold: {} })
  bold.insert(8, " and ", { bold: null })
  p.insert(0, [
    bold,
    mention("markdown-layer", "doc-2", "Notes"),
    new Y.XmlText(", "),
    mention("chat", "ws-1", "Fix the login"),
    new Y.XmlText(", "),
    mention("mockup-layer", "mock-1", "Hero"),
  ])
  fragment.insert(0, [title, p])
}

function pills(fragment: Y.XmlFragment) {
  const out: Array<Record<string, unknown>> = []
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === "mention") out.push(child.getAttributes())
      else walk(child)
    }
  }
  walk(fragment)
  return out
}

describe("append_to_document_body", () => {
  it("keeps the Document’s mention pills and inline marks", async () => {
    const { run, fragment } = setup()
    typeBody(fragment)

    await run("append_to_document_body", {
      document_id: "doc-1",
      content: "More **news**.",
    })

    expect(pills(fragment)).toEqual([
      { id: "doc-2", label: "Notes", kind: "markdown-layer" },
      { id: "ws-1", label: "Fix the login", kind: "chat" },
      { id: "mock-1", label: "Hero", kind: "mockup-layer" },
    ])
    const first = (fragment.get(1) as Y.XmlElement).get(0) as Y.XmlText
    expect(first.toDelta()).toEqual([
      { insert: "See " },
      { insert: "this", attributes: { bold: {} } },
      { insert: " and " },
    ])
    const appended = fragment.get(2) as Y.XmlElement
    expect(appended.nodeName).toBe("paragraph")
    expect((appended.get(0) as Y.XmlText).toDelta()).toEqual([
      { insert: "More " },
      { insert: "news", attributes: { bold: {} } },
      { insert: "." },
    ])
  })

  it("doesn’t warn that appending flattens marks", async () => {
    const tools = buildDocumentTools({
      room: {} as RoomDoc,
      chatId: "chat-1",
    })
    expect(tools.append_to_document_body.description).not.toMatch(/flatten/)
  })
})

describe("read_document", () => {
  it("shows each mention’s current name and kind", async () => {
    const { run, fragment, collections } = setup()
    typeBody(fragment)
    collections.markdownLayers.update("doc-2", { title: "Field notes" })
    collections.branches.update("ws-1", { title: "Fix sign in" })
    collections.mockupLayers.update("mock-1", { title: "Hero v2" })

    const out = await run("read_document", { id: "doc-1" })

    expect(out).toBe(
      [
        "# Plan",
        "",
        "See **this** and [@Field notes](mention:document:doc-2), " +
          "[@Fix sign in](mention:chat:ws-1), [@Hero v2](mention:mockup:mock-1)",
      ].join("\n")
    )
  })

  it("reads what a body written with mentions wrote", async () => {
    const { run, fragment } = setup()
    typeBody(fragment)
    const body = (await run("read_document", { id: "doc-1" }))
      .split("\n")
      .slice(2)
      .join("\n")

    await run("replace_document_body", { document_id: "doc-1", content: body })

    expect(pills(fragment)).toHaveLength(3)
    expect(
      (await run("read_document", { id: "doc-1" })).split("\n").slice(2)
    ).toEqual(body.split("\n"))
  })
})

describe("holding a Document (#1725)", () => {
  it("refuses another chat’s edit with the holder’s name, then allows it", async () => {
    const { run, collections } = setup()
    collections.chatSessions.set(
      "chat-2",
      baseChat("chat-2", {
        label: "Checkout polish",
        isStreaming: true,
        workingLayers: { "doc-2": 1 },
      })
    )

    const refused = await run("set_document_title", {
      document_id: "doc-2",
      title: "Mine",
    })

    expect(refused).toBe(
      "Checkout polish is changing this right now; tell the person and try again later."
    )
    expect(collections.markdownLayers.get("doc-2")).toMatchObject({
      title: "Notes",
    })
    expect(collections.markdownLayers.get("doc-2")?.lastChangedByChatId).toBe(
      undefined
    )

    collections.chatSessions.update("chat-2", { isStreaming: false })
    await run("set_document_title", { document_id: "doc-2", title: "Mine" })

    expect(collections.markdownLayers.get("doc-2")).toMatchObject({
      title: "Mine",
      lastChangedByChatId: "chat-1",
    })
  })

  it("holds the Documents this chat creates and edits", async () => {
    const { run, collections } = setup()
    collections.chatSessions.update("chat-1", { isStreaming: true })

    const out = await run("create_document", { title: "Spec" })
    const docId = /id ([^)]+)\)/.exec(out)?.[1] ?? ""
    await run("append_to_document_body", {
      document_id: "doc-1",
      content: "More.",
    })

    expect(
      Object.keys(collections.chatSessions.get("chat-1")?.workingLayers ?? {})
    ).toEqual([docId, "doc-1"])
  })
})

describe("pages (#1842)", () => {
  function onPages() {
    const sender = { page: "page-2" as string | undefined }
    const t = setup(() => sender.page)
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
    const pageOf = (docId: string) =>
      t.collections.iframeLayerGroups
        .toArray()
        .find((g) => g.members.some((m) => m.id === docId))?.pageId
    const idIn = (out: string) => /id ([^)]+)\)/.exec(out)?.[1] ?? ""
    return { ...t, sender, pageOf, idIn }
  }

  it("lands on the sender’s page", async () => {
    const { run, pageOf, idIn } = onPages()

    const id = idIn(await run("create_document", { title: "Spec" }))

    expect(pageOf(id)).toBe("page-2")
  })

  it("lands on a page it names", async () => {
    const { run, pageOf, idIn } = onPages()

    const id = idIn(
      await run("create_document", { title: "Spec", page: "Page 1" })
    )

    expect(pageOf(id)).toBe("page-1")
  })

  it("lists the pages for a name no page has, and makes nothing", async () => {
    const { run, collections } = onPages()
    const before = collections.markdownLayers.toArray().length

    const out = await run("create_document", { title: "Spec", page: "Nope" })

    expect(out).toContain('no page "Nope"')
    expect(out).toContain('"Page 1" (page-1), "Explorations" (page-2)')
    expect(collections.markdownLayers.toArray()).toHaveLength(before)
  })

  it("sits beside the chat’s Groups on that page, not on another", async () => {
    const { run, collections, idIn, sender } = onPages()
    // The chat's Document on Page 1, far from the origin.
    collections.iframeLayerGroups.set("g-plan", {
      id: "g-plan",
      name: "Plan",
      pageId: "page-1",
      x: 5000,
      y: 5000,
      members: [{ kind: "markdown-layer", id: "doc-1" }],
    })
    sender.page = "page-1"
    const beside = idIn(await run("create_document", { title: "A" }))
    sender.page = "page-2"
    const elsewhere = idIn(await run("create_document", { title: "B" }))

    const groupOf = (id: string) =>
      collections.iframeLayerGroups
        .toArray()
        .find((g) => g.members.some((m) => m.id === id))!
    expect(groupOf(beside)).toMatchObject({ pageId: "page-1", y: 5000 })
    expect(groupOf(beside).x).toBeGreaterThan(5000)
    expect(groupOf(elsewhere)).toMatchObject({ pageId: "page-2" })
    expect(groupOf(elsewhere).x).toBeLessThan(5000)
  })

  it("read_document says which page a Document is on", async () => {
    const { run, idIn } = onPages()
    const id = idIn(await run("create_document", { title: "Spec" }))

    expect(await run("read_document", { id })).toMatch(
      /^Page: "Explorations"\n\n# Spec\n/
    )
  })
})

describe("files and views (#1883)", () => {
  it("edits the file through any view of it, and reads it by the file", async () => {
    const { run, collections } = setup()
    collections.iframeLayerGroups.set("group-1", {
      id: "group-1",
      x: 0,
      y: 0,
      members: [{ kind: "markdown-layer", id: "doc-2" }],
    })
    collections.markdownLayers.addView("view-2", "doc-1", {
      width: 300,
      height: 200,
    })

    await run("replace_document_body", {
      document_id: "view-2",
      content: "One body.",
    })
    await run("set_document_title", { document_id: "view-2", title: "Plan B" })

    expect(collections.markdownLayers.get("doc-1")).toMatchObject({
      title: "Plan B",
      lastChangedByChatId: "chat-1",
    })
    const read = await run("read_document", { id: "doc-1" })
    expect(read).toContain("# Plan B")
    expect(read).toContain("One body.")
  })
})

describe("Documents off the canvas (#1885)", () => {
  it("makes a Document with no view when it isn’t placed, and edits it", async () => {
    const { collections, run } = setup()

    const out = await run("create_document", {
      title: "Answer",
      content: "First line.",
      place: false,
    })
    const fileId = /id ([^)]+)\)/.exec(out)![1]!

    expect(out).toContain("not on the canvas")
    expect(collections.markdownLayers.has(fileId)).toBe(false)
    expect(collections.layerFiles.get(fileId)).toMatchObject({
      kind: "document",
      title: "Answer",
      lastChangedByChatId: "chat-1",
    })
    await run("append_to_document_body", {
      document_id: fileId,
      content: "Second line.",
    })
    const read = await run("read_document", { id: fileId })
    expect(read).toContain("First line.")
    expect(read).toContain("Second line.")
  })
})
