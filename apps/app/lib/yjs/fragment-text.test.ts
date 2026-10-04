import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  documentFragment,
  fragmentBodyToPlainText,
  getFragmentTitle,
  replaceFragmentBodyPreservingTitle,
  setFragmentTitle,
} from "@/lib/yjs/fragment-text"

describe("documentFragment", () => {
  it("resolves a writable body fragment for a document layer id", () => {
    const doc = new Y.Doc()

    const fragment = documentFragment(doc, "doc-1")
    setFragmentTitle(fragment, "Roadmap")

    expect(getFragmentTitle(documentFragment(doc, "doc-1"))).toBe("Roadmap")
  })

  it("keeps distinct document ids on independent fragments", () => {
    const doc = new Y.Doc()

    setFragmentTitle(documentFragment(doc, "doc-1"), "Roadmap")
    setFragmentTitle(documentFragment(doc, "doc-2"), "Notes")

    expect(getFragmentTitle(documentFragment(doc, "doc-1"))).toBe("Roadmap")
    expect(getFragmentTitle(documentFragment(doc, "doc-2"))).toBe("Notes")
  })

  it("resolves the persisted `markdown-layer-{id}` key so existing rooms keep loading", () => {
    const doc = new Y.Doc()

    expect(documentFragment(doc, "doc-1")).toBe(
      doc.getXmlFragment("markdown-layer-doc-1")
    )
  })
})

describe("Document images in markdown", () => {
  const bodyOf = (markdown: string) => {
    const fragment = documentFragment(new Y.Doc(), "doc-1")
    replaceFragmentBodyPreservingTitle(fragment, markdown)
    return fragment
  }

  it("reads an image as its own block and writes it back as markdown", () => {
    const fragment = bodyOf("Before\n\n![Sketch](uploads/sketch.png)\n\nAfter")

    const names = fragment.toArray().map((n) => (n as Y.XmlElement).nodeName)
    expect(names).toEqual(["heading", "paragraph", "image", "paragraph"])
    expect(fragmentBodyToPlainText(fragment)).toBe(
      "Before\n\n![Sketch](uploads/sketch.png)\n\nAfter"
    )
  })

  it("splits a paragraph around an image inside it", () => {
    const fragment = bodyOf("See ![Sketch](uploads/sketch.png) here")

    const names = fragment.toArray().map((n) => (n as Y.XmlElement).nodeName)
    expect(names).toEqual(["heading", "paragraph", "image", "paragraph"])
  })

  it("keeps a path with spaces whole, in angle brackets", () => {
    const fragment = bodyOf("![Flow](<uploads/user flow.png>)")
    const text = fragmentBodyToPlainText(fragment)

    expect(text).toBe("![Flow](<uploads/user flow.png>)")
    expect(fragmentBodyToPlainText(bodyOf(text))).toBe(text)
  })

  it("keeps images when a body is appended to from its text", () => {
    const fragment = bodyOf("![Sketch](uploads/sketch.png)")
    replaceFragmentBodyPreservingTitle(
      fragment,
      `${fragmentBodyToPlainText(fragment)}\n\nMore`
    )

    expect(fragmentBodyToPlainText(fragment)).toBe(
      "![Sketch](uploads/sketch.png)\n\nMore"
    )
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
