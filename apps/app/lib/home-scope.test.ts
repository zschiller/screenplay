import { describe, expect, it } from "vitest"
import { deriveHomeScope } from "./home-scope"

// The lifted home store is scoped from the URL, not page props (#510): these
// pin the three cases the content grid distinguishes — the flat Recents root,
// the All files root, and a single folder — plus the routes that opt out.
describe("deriveHomeScope", () => {
  it("Recents (/) is the flat list with no folder scoping", () => {
    expect(deriveHomeScope("/", undefined)).toEqual({
      folderView: false,
      currentFolderId: null,
    })
  })

  it("/files is the folder-tree root", () => {
    expect(deriveHomeScope("/files", undefined)).toEqual({
      folderView: true,
      currentFolderId: null,
    })
  })

  it("/files/<id> scopes the grid to that folder", () => {
    expect(deriveHomeScope("/files/abc123", "abc123")).toEqual({
      folderView: true,
      currentFolderId: "abc123",
    })
  })

  it("non-files routes (e.g. /settings) opt out of folder scoping", () => {
    expect(deriveHomeScope("/settings", undefined)).toEqual({
      folderView: false,
      currentFolderId: null,
    })
  })

  it("ignores a stray folderId param outside the files tree", () => {
    expect(deriveHomeScope("/", "abc123")).toEqual({
      folderView: false,
      currentFolderId: null,
    })
  })

  it("ignores an array folderId (no single folder is scoped)", () => {
    expect(deriveHomeScope("/files", ["a", "b"])).toEqual({
      folderView: true,
      currentFolderId: null,
    })
  })
})
