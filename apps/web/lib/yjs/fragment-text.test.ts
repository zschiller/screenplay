import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  documentFragment,
  getFragmentTitle,
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
