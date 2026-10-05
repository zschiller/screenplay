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
function setup() {
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
    ...buildDocumentTools({ room, chatId: "chat-1" }),
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
