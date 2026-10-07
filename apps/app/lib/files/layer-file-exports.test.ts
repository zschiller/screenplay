import { describe, expect, it } from "vitest"

import { makeHarness } from "@/test/canvas/harness"
import { writeDocumentMarkdown } from "@/lib/document-markdown"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { layerFileExports } from "./layer-file-exports"

describe("layerFileExports", () => {
  it("writes each Document as markdown and each Mockup as its page, placed or not", () => {
    const { doc, ops, collections } = makeHarness()
    const { docId } = ops.createDocument(
      { x: 0, y: 0 },
      { width: 480, height: 640 }
    )
    ops.renameDocument(docId, "Plan")
    writeDocumentMarkdown(documentFragment(doc, docId), "Ship it.", {
      keepTitle: true,
    })
    const { mockupId } = ops.createMockup({
      html: "<p>Hero</p>",
      title: "Hero",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 900 },
    })!
    // Not on canvas: the file still goes to the mirror.
    ops.removeMockups([mockupId])

    expect(layerFileExports(collections)).toEqual(
      expect.arrayContaining([
        { path: "Documents/Plan.md", text: "# Plan\n\nShip it.\n" },
        { path: "Mockups/Hero.html", text: "<p>Hero</p>" },
      ])
    )
  })

  it("leaves out a deleted file", () => {
    const { ops, collections } = makeHarness()
    const { mockupId } = ops.createMockup({
      html: "<p>Hero</p>",
      title: "Hero",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 0 },
    })!

    ops.deleteFiles([mockupId])

    expect(layerFileExports(collections)).toEqual([])
  })
})
