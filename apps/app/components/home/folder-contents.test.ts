import { describe, expect, it } from "vitest"
import { formatFolderContents } from "./folder-contents"

describe("formatFolderContents", () => {
  it("counts canvases alone", () => {
    expect(formatFolderContents({ folders: 0, canvases: 3 })).toBe("3 canvases")
    expect(formatFolderContents({ folders: 0, canvases: 1 })).toBe("1 canvas")
  })

  it("lists sub-folders before canvases", () => {
    expect(formatFolderContents({ folders: 1, canvases: 2 })).toBe(
      "1 folder, 2 canvases"
    )
    expect(formatFolderContents({ folders: 2, canvases: 0 })).toBe("2 folders")
  })

  it("says Empty when there is nothing inside", () => {
    expect(formatFolderContents({ folders: 0, canvases: 0 })).toBe("Empty")
  })
})
