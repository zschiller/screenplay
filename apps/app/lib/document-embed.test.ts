import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  blockGapAt,
  mockupEmbedId,
  mockupEmbedMarkdown,
} from "@/lib/document-embed"
import {
  readDocumentBody,
  writeDocumentMarkdown,
} from "@/lib/document-markdown"
import { documentFragment, setFragmentTitle } from "@/lib/yjs/fragment-text"

describe("Mockup embeds (#1888)", () => {
  it("reads the Mockup a mockup URL names, and nothing from a path", () => {
    expect(mockupEmbedId("mockup:m-1")).toBe("m-1")
    expect(mockupEmbedId("uploads/m-1.png")).toBeNull()
    expect(mockupEmbedId("https://example.com/mockup:m-1")).toBeNull()
    expect(mockupEmbedId("mockup:")).toBeNull()
    expect(mockupEmbedId(null)).toBeNull()
  })

  it("is written like a Document image", () => {
    expect(mockupEmbedMarkdown("m-1", "Option [B]")).toBe(
      "![Option B](mockup:m-1)"
    )
  })

  it("lands as its own block between paragraphs, as an image does", () => {
    const fragment = documentFragment(new Y.Doc(), "doc-1")
    setFragmentTitle(fragment, "Brief")
    writeDocumentMarkdown(fragment, "Before ![Option B](mockup:m-1) after", {
      keepTitle: true,
    })
    expect(fragment.toArray().map((n) => (n as Y.XmlElement).nodeName)).toEqual(
      ["heading", "paragraph", "image", "paragraph"]
    )
    expect((fragment.get(2) as Y.XmlElement).getAttribute("src")).toBe(
      "mockup:m-1"
    )
  })

  it("reads with the Mockup’s current name", () => {
    const fragment = documentFragment(new Y.Doc(), "doc-1")
    setFragmentTitle(fragment, "Brief")
    writeDocumentMarkdown(fragment, "![Option B](mockup:m-1)", {
      keepTitle: true,
    })
    expect(
      readDocumentBody(fragment, (kind, id) =>
        kind === "mockup-layer" && id === "m-1"
          ? "Option B · Suggestions"
          : undefined
      )
    ).toBe("![Option B · Suggestions](mockup:m-1)")
    // A Mockup that's gone keeps the name it was embedded with.
    expect(readDocumentBody(fragment, () => undefined)).toBe(
      "![Option B](mockup:m-1)"
    )
  })
})

describe("blockGapAt", () => {
  const blocks = [
    { pos: 0, top: 0, bottom: 40 }, // the title
    { pos: 10, top: 50, bottom: 90 },
    { pos: 30, top: 100, bottom: 200 },
  ]

  it("takes the gap above the block whose upper half the pointer is in", () => {
    expect(blockGapAt(blocks, 60, 60)).toEqual({ pos: 10, y: 45 })
    expect(blockGapAt(blocks, 60, 120)).toEqual({ pos: 30, y: 95 })
  })

  it("never goes above the title", () => {
    expect(blockGapAt(blocks, 60, -20)).toEqual({ pos: 10, y: 45 })
  })

  it("takes the end below the last block’s middle", () => {
    expect(blockGapAt(blocks, 60, 180)).toEqual({ pos: 60, y: 200 })
  })

  it("puts a drop into a Document with only a title after it", () => {
    expect(blockGapAt([blocks[0]!], 8, 100)).toEqual({ pos: 8, y: 40 })
    expect(blockGapAt([], 0, 0)).toBeNull()
  })
})
