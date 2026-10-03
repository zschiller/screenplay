import { describe, expect, it } from "vitest"

import {
  ancestorPaths,
  formatFileSize,
  isWithin,
  mediaTypeFor,
  normalizeFilePath,
} from "./paths"

describe("normalizeFilePath", () => {
  it("trims and collapses slashes and drops `.`", () => {
    expect(normalizeFilePath(" /notes//./research.md/ ")).toEqual({
      path: "notes/research.md",
    })
  })

  it("refuses an empty path, a climb out, and control characters", () => {
    expect(normalizeFilePath("/")).toHaveProperty("error")
    expect(normalizeFilePath("notes/../../etc/passwd")).toHaveProperty("error")
    expect(normalizeFilePath("a\u0000b")).toHaveProperty("error")
  })
})

describe("path helpers", () => {
  it("lists the folders above a path, outermost first", () => {
    expect(ancestorPaths("a/b/c.md")).toEqual(["a", "a/b"])
    expect(ancestorPaths("c.md")).toEqual([])
  })

  it("knows a folder's contents from a sibling with the same prefix", () => {
    expect(isWithin("notes/a.md", "notes")).toBe(true)
    expect(isWithin("notes", "notes")).toBe(true)
    expect(isWithin("notes-old/a.md", "notes")).toBe(false)
  })

  it("picks a media type by extension, with a fallback", () => {
    expect(mediaTypeFor("a/B.PDF", "x")).toBe("application/pdf")
    expect(mediaTypeFor("README", "text/plain")).toBe("text/plain")
    expect(mediaTypeFor(".env", "text/plain")).toBe("text/plain")
  })

  it("formats sizes the way people read them", () => {
    expect(formatFileSize(812)).toBe("812 B")
    expect(formatFileSize(2150)).toBe("2.1 KB")
    expect(formatFileSize(3.4 * 1024 * 1024)).toBe("3.4 MB")
  })
})
