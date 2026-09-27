import { describe, expect, it } from "vitest"

import { diffLines, foldContext } from "./line-diff"

describe("diffLines", () => {
  it("marks only the lines that changed, keeping shared lines as context", () => {
    const rows = diffLines("a\nb\nc\n", "a\nB\nc\n")
    expect(rows).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "context", text: "c" },
    ])
  })

  it("keeps an unchanged line between two changes as context", () => {
    const rows = diffLines("x\nkeep\ny", "X\nkeep\nY\nZ")
    expect(rows.map((r) => r.kind)).toEqual([
      "removed",
      "added",
      "context",
      "removed",
      "added",
      "added",
    ])
  })

  it("renders a new file as all added", () => {
    expect(diffLines(null, "one\ntwo")).toEqual([
      { kind: "added", text: "one" },
      { kind: "added", text: "two" },
    ])
  })

  it("renders an emptied file as all removed", () => {
    expect(diffLines("one\ntwo", "")).toEqual([
      { kind: "removed", text: "one" },
      { kind: "removed", text: "two" },
    ])
  })

  it("doesn't invent an empty line from a trailing newline", () => {
    expect(diffLines("a\n", "a\n")).toEqual([{ kind: "context", text: "a" }])
  })
})

describe("foldContext", () => {
  const file = (n: number) =>
    Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")

  it("folds unchanged lines far from any change", () => {
    const before = file(20)
    const after = before.replace("line 10", "line ten")
    const rows = foldContext(diffLines(before, after))
    expect(rows[0]).toEqual({ kind: "skip", count: 6 })
    expect(rows.filter((r) => r.kind === "context")).toHaveLength(6)
    expect(rows[rows.length - 1]).toEqual({ kind: "skip", count: 7 })
  })

  it("never folds a single line", () => {
    const before = file(5)
    const after = before.replace("line 5", "line five")
    const rows = foldContext(diffLines(before, after))
    expect(rows.some((r) => r.kind === "skip")).toBe(false)
    expect(rows).toHaveLength(6)
  })
})
