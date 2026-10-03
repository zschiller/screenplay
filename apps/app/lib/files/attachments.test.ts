import { describe, expect, it } from "vitest"

import { checkAttachment, isInlineImage } from "./attachments"
import { freePath } from "./paths"

const MB = 1024 * 1024

describe("checkAttachment (#1525)", () => {
  it("takes images, PDFs, and text and code files", () => {
    expect(
      checkAttachment({ name: "shot.png", size: 10, type: "image/png" })
    ).toEqual({ ok: true, name: "shot.png", mediaType: "image/png" })
    expect(
      checkAttachment({ name: "brief.pdf", size: 10, type: "application/pdf" })
    ).toEqual({ ok: true, name: "brief.pdf", mediaType: "application/pdf" })
    expect(
      checkAttachment({ name: "notes.md", size: 10, type: "" })
    ).toMatchObject({ ok: true, mediaType: "text/markdown" })
    expect(
      checkAttachment({ name: "plain", size: 10, type: "text/plain" })
    ).toMatchObject({ ok: true, mediaType: "text/plain" })
  })

  it("goes by the extension over the browser's type for code", () => {
    // Browsers call a `.ts` file an MPEG transport stream.
    expect(
      checkAttachment({ name: "app.ts", size: 10, type: "video/mp2t" })
    ).toMatchObject({ ok: true, mediaType: "text/x-typescript" })
    expect(
      checkAttachment({ name: "main.go", size: 10, type: "" })
    ).toMatchObject({ ok: true, mediaType: "text/plain" })
  })

  it("refuses other types, saying what can be attached", () => {
    const check = checkAttachment({
      name: "movie.mov",
      size: 10,
      type: "video/quicktime",
    })
    expect(check).toEqual({
      ok: false,
      error:
        "movie.mov can't be attached. Agents read images, PDFs, and text and code files.",
    })
    expect(
      checkAttachment({
        name: "archive.zip",
        size: 10,
        type: "application/zip",
      }).ok
    ).toBe(false)
  })

  it("refuses a file over 25 MB, saying how big it is", () => {
    expect(
      checkAttachment({ name: "huge.png", size: 30 * MB, type: "image/png" })
    ).toEqual({
      ok: false,
      error: "huge.png is 30.0 MB. Files can be up to 25.0 MB.",
    })
    expect(
      checkAttachment({ name: "edge.png", size: 25 * MB, type: "image/png" }).ok
    ).toBe(true)
  })

  it("keeps a name to one path segment, and names a nameless image", () => {
    expect(
      checkAttachment({ name: "../../etc/x.md", size: 1, type: "" })
    ).toMatchObject({ ok: true, name: "x.md" })
    expect(
      checkAttachment({ name: "", size: 1, type: "image/jpeg" })
    ).toMatchObject({ ok: true, name: "attachment.jpg" })
  })
})

describe("isInlineImage", () => {
  it("sends model-readable images up to 5 MB inline", () => {
    expect(isInlineImage("image/png", 5 * MB)).toBe(true)
    expect(isInlineImage("image/png", 5 * MB + 1)).toBe(false)
    expect(isInlineImage("image/svg+xml", 10)).toBe(false)
    expect(isInlineImage("application/pdf", 10)).toBe(false)
  })
})

describe("freePath", () => {
  it("adds a suffix before the extension until the path is free", () => {
    const taken = new Set(["uploads/a.png", "uploads/a-2.png", "uploads/b"])
    const has = (p: string) => taken.has(p)
    expect(freePath("uploads/new.png", has)).toBe("uploads/new.png")
    expect(freePath("uploads/a.png", has)).toBe("uploads/a-3.png")
    expect(freePath("uploads/b", has)).toBe("uploads/b-2")
    expect(freePath("top.md", (p) => p === "top.md")).toBe("top-2.md")
  })
})
