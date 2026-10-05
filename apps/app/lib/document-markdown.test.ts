import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getSchema } from "@tiptap/core"
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap"

import {
  appendDocumentMarkdown,
  documentExtensions,
  readDocumentBody,
  writeDocumentMarkdown,
} from "@/lib/document-markdown"
import { getLineNumbers } from "@/lib/document-comments"
import { MENTION_KIND_REGISTRY, MENTION_KINDS } from "@/lib/mention-kinds"
import { documentFragment, setFragmentTitle } from "@/lib/yjs/fragment-text"

function bodyOf(markdown: string): Y.XmlFragment {
  const fragment = documentFragment(new Y.Doc(), "doc-1")
  setFragmentTitle(fragment, "Plan")
  writeDocumentMarkdown(fragment, markdown, { keepTitle: true })
  return fragment
}

const names = (fragment: Y.XmlFragment) =>
  fragment.toArray().map((n) => (n as Y.XmlElement).nodeName)

describe("Document Markdown round trip", () => {
  it.each([
    ["a paragraph", "Just words."],
    ["headings", "## Goals\n\nShip it.\n\n### Later\n\nMaybe."],
    ["a bullet list", "- one\n- two\n  - nested"],
    ["an ordered list", "1. first\n2. second"],
    ["a blockquote", "> quoted"],
    ["a code block", "```ts\nconst a = 1\nconst b = 2\n```"],
    ["a rule", "Above\n\n---\n\nBelow"],
    [
      "marks",
      "**bold** *italic* ~~struck~~ `code` [link](https://example.com)",
    ],
    ["an image", "![Sketch](uploads/sketch.png)"],
    ["an image path with spaces", "![Flow](<uploads/user flow.png>)"],
    ["a document mention", "See [@Notes](mention:document:doc-2)."],
    ["a chat mention", "Ask [@Fix the login](mention:chat:ws-1)."],
    ["a mockup mention", "Like [@Hero](mention:mockup:mock-1)."],
  ])("keeps %s", (_, markdown) => {
    expect(readDocumentBody(bodyOf(markdown))).toBe(markdown)
  })

  it("stores a mention as the editor’s pill", () => {
    const fragment = bodyOf("Ask [@Fix the login](mention:chat:ws-1).")
    const p = fragment.get(1) as Y.XmlElement
    const pill = p.get(1) as Y.XmlElement

    expect(pill.nodeName).toBe("mention")
    expect(pill.getAttributes()).toMatchObject({
      id: "ws-1",
      label: "Fix the login",
      kind: "chat",
    })
  })

  it.each(MENTION_KINDS)("keeps a %s mention and its kind", (kind) => {
    const name = MENTION_KIND_REGISTRY[kind].markdownName
    const markdown = `See [@Target](mention:${name}:target-1).`
    const fragment = bodyOf(markdown)
    const pill = (fragment.get(1) as Y.XmlElement).get(1) as Y.XmlElement

    expect(pill.getAttribute("kind")).toBe(kind)
    expect(readDocumentBody(fragment)).toBe(markdown)
  })

  it("reads the composer’s kindless mention as a document", () => {
    const fragment = bodyOf("See [@Notes](mention:doc-2).")

    expect(readDocumentBody(fragment)).toBe(
      "See [@Notes](mention:document:doc-2)."
    )
  })

  it("names each mention by its current name", () => {
    const fragment = bodyOf("See [@Notes](mention:document:doc-2).")

    expect(
      readDocumentBody(fragment, (kind, id) =>
        kind === "markdown-layer" && id === "doc-2" ? "Field notes" : undefined
      )
    ).toBe("See [@Field notes](mention:document:doc-2).")
  })

  it("keeps the title when writing the body", () => {
    const fragment = bodyOf("# Not the title\n\nBody")

    expect(names(fragment)).toEqual(["heading", "heading", "paragraph"])
    expect(readDocumentBody(fragment)).toBe("# Not the title\n\nBody")
  })

  it("writes a whole Document, its first heading the title", () => {
    const fragment = documentFragment(new Y.Doc(), "doc-1")
    writeDocumentMarkdown(fragment, "# Plan\n\nBody", { keepTitle: false })

    expect(names(fragment)).toEqual(["heading", "paragraph"])
    expect(readDocumentBody(fragment)).toBe("Body")
  })

  it("leaves a paragraph to type in when the body is empty", () => {
    expect(names(bodyOf(""))).toEqual(["heading", "paragraph"])
  })
})

describe("Document images in markdown", () => {
  it("reads an image as its own block", () => {
    const fragment = bodyOf("Before\n\n![Sketch](uploads/sketch.png)\n\nAfter")

    expect(names(fragment)).toEqual([
      "heading",
      "paragraph",
      "image",
      "paragraph",
    ])
  })

  it("splits a paragraph around an image inside it", () => {
    const fragment = bodyOf("See ![Sketch](uploads/sketch.png) here")

    expect(names(fragment)).toEqual([
      "heading",
      "paragraph",
      "image",
      "paragraph",
    ])
  })

  it("keeps a list item that leads with an image valid", () => {
    const fragment = bodyOf("- ![Sketch](uploads/sketch.png)")
    const item = (fragment.get(1) as Y.XmlElement).get(0) as Y.XmlElement

    expect(item.toArray().map((n) => (n as Y.XmlElement).nodeName)).toEqual([
      "paragraph",
      "image",
    ])
  })
})

describe("appendDocumentMarkdown", () => {
  it("adds blocks after the body", () => {
    const fragment = bodyOf("![Sketch](uploads/sketch.png)")
    appendDocumentMarkdown(fragment, "More")

    expect(readDocumentBody(fragment)).toBe(
      "![Sketch](uploads/sketch.png)\n\nMore"
    )
  })

  it("fills an empty Document’s typing slot instead of following it", () => {
    const fragment = bodyOf("")
    appendDocumentMarkdown(fragment, "First")

    expect(names(fragment)).toEqual(["heading", "paragraph"])
    expect(readDocumentBody(fragment)).toBe("First")
  })
})

describe("comment line numbers", () => {
  const schema = getSchema(documentExtensions())

  /** Where `word` starts and ends in the editor's doc for `fragment`. */
  function rangeOf(fragment: Y.XmlFragment, word: string) {
    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    let found: { from: number; to: number } | undefined
    doc.descendants((node, pos) => {
      const at = node.isText ? node.text!.indexOf(word) : -1
      if (!found && at >= 0) {
        found = { from: pos + at, to: pos + at + word.length }
      }
    })
    return { doc, ...found! }
  }

  it.each(["Intro", "Goals", "alpha", "beta", "second", "quoted", "After"])(
    "points at the line `read_document` shows %s on",
    (word) => {
      const fragment = bodyOf(
        [
          "Intro with [@Notes](mention:document:doc-2)",
          "## Goals",
          "- alpha\n- beta",
          "```\nfirst\nsecond\n```",
          "> quoted",
          "![Sketch](uploads/sketch.png)",
          "After **bold**",
        ].join("\n\n")
      )
      const lines = readDocumentBody(fragment).split("\n")
      const { doc, from, to } = rangeOf(fragment, word)

      const { lineFrom, lineTo } = getLineNumbers(doc, from, to)

      expect(lines[lineFrom - 1]).toContain(word)
      expect(lineTo).toBe(lineFrom)
    }
  )

  it("spans the lines a range crosses", () => {
    const fragment = bodyOf("One\n\nTwo")
    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    const one = rangeOf(fragment, "One")
    const two = rangeOf(fragment, "Two")

    expect(getLineNumbers(doc, one.from, two.to)).toEqual({
      lineFrom: 1,
      lineTo: 3,
    })
  })
})
