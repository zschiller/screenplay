import { describe, expect, it } from "vitest"

import { renderFileWindow } from "@/lib/agent/render"

describe("renderFileWindow", () => {
  it("prefixes each line with a 1-based, cat -n-style line number", () => {
    const out = renderFileWindow({ content: "alpha\nbeta\ngamma" })

    expect(out).toBe("     1\talpha\n     2\tbeta\n     3\tgamma")
  })

  it("windows to offset/limit and keeps line numbers absolute", () => {
    const content = "l1\nl2\nl3\nl4\nl5"

    const out = renderFileWindow({ content, offset: 2, limit: 2 })

    expect(out).toContain("2\tl2")
    expect(out).toContain("3\tl3")
    expect(out).not.toContain("\tl1")
    expect(out).not.toContain("\tl4")
  })

  it("appends a truncation notice when more lines follow the window", () => {
    const content = "l1\nl2\nl3\nl4\nl5"

    const out = renderFileWindow({ content, offset: 1, limit: 2 })

    expect(out).toContain("5 lines")
    expect(out.toLowerCase()).toContain("offset")
  })

  it("adds no notice when the window covers the rest of the file", () => {
    const out = renderFileWindow({ content: "l1\nl2", offset: 1, limit: 10 })

    expect(out).toBe("     1\tl1\n     2\tl2")
  })

  it("reports an empty file rather than an empty string", () => {
    expect(renderFileWindow({ content: "" })).toBe("(empty file)")
  })

  it("numbers a single-line file without a trailing blank line", () => {
    expect(renderFileWindow({ content: "only" })).toBe("     1\tonly")
  })
})
