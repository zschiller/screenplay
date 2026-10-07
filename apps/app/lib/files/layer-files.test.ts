import { describe, expect, it } from "vitest"

import { layerFileDetail, layerFilePaths } from "./layer-files"

describe("layerFilePaths", () => {
  it("files Documents as .md and Mockups as .html under their titles", () => {
    const paths = layerFilePaths([
      { id: "d1", kind: "document", title: "Checkout plan" },
      { id: "m1", kind: "mockup", title: "Cart · B" },
    ])

    expect(paths.get("d1")).toBe("Documents/Checkout plan.md")
    expect(paths.get("m1")).toBe("Mockups/Cart · B.html")
  })

  it("numbers a repeated title, and a path a saved file already has, the same way every time", () => {
    const files = [
      { id: "b", kind: "mockup" as const, title: "Hero" },
      { id: "a", kind: "mockup" as const, title: "hero" },
      { id: "c", kind: "document" as const, title: "Notes" },
    ]
    const paths = layerFilePaths(files, ["Documents/Notes.md"])

    expect(paths.get("a")).toBe("Mockups/hero.html")
    expect(paths.get("b")).toBe("Mockups/Hero 2.html")
    expect(paths.get("c")).toBe("Documents/Notes 2.md")
    expect(
      layerFilePaths([...files].reverse(), ["Documents/Notes.md"])
    ).toEqual(paths)
  })

  it("keeps a title to one safe name", () => {
    const paths = layerFilePaths([
      { id: "a", kind: "document", title: "" },
      { id: "b", kind: "document", title: "a/b: c" },
      { id: "c", kind: "document", title: "..hidden" },
    ])

    expect(paths.get("a")).toBe("Documents/Untitled.md")
    expect(paths.get("b")).toBe("Documents/a-b- c.md")
    expect(paths.get("c")).toBe("Documents/hidden.md")
  })
})

describe("layerFileDetail", () => {
  it("says Not on canvas for a file with no view", () => {
    expect(layerFileDetail(0)).toBe("Not on canvas")
    expect(layerFileDetail(1)).toBe("1 view")
    expect(layerFileDetail(3)).toBe("3 views")
  })
})
