import { describe, expect, it } from "vitest"

import { makeHarness } from "@/test/canvas/harness"
import { writeDocumentMarkdown } from "@/lib/document-markdown"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { layerFileExports, mockupFileIds } from "./layer-file-exports"

describe("layerFileExports", () => {
  it("writes each Document as markdown and each Mockup as its folder’s page, placed or not", () => {
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
      title: "Hero",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 900 },
    })!
    // Not on canvas: the file still goes to the mirror.
    ops.removeMockups([mockupId])

    expect(mockupFileIds(collections)).toEqual([mockupId])
    const pages = new Map([[mockupId, "<p>Hero</p>"]])
    expect(layerFileExports(collections, pages)).toEqual(
      expect.arrayContaining([
        { path: "Documents/Plan.md", text: "# Plan\n\nShip it.\n" },
        { path: "Mockups/Hero.html", text: "<p>Hero</p>" },
      ])
    )
  })

  it("leaves out a deleted file", () => {
    const { ops, collections } = makeHarness()
    const { mockupId } = ops.createMockup({
      title: "Hero",
      width: 400,
      height: 300,
      anchor: { x: 0, y: 0 },
    })!

    ops.deleteFiles([mockupId])

    expect(mockupFileIds(collections)).toEqual([])
    expect(
      layerFileExports(collections, new Map([[mockupId, "<p>Hero</p>"]]))
    ).toEqual([])
  })
})
