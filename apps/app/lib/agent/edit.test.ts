import { describe, expect, it } from "vitest"

import { applyTextEdit } from "@/lib/agent/edit"

describe("applyTextEdit", () => {
  it("replaces a unique match and reports one replacement", () => {
    const result = applyTextEdit({
      content: "const x = 1",
      oldString: "1",
      newString: "2",
    })

    expect(result).toEqual({
      ok: true,
      content: "const x = 2",
      replacements: 1,
    })
  })

  it("reports not_found when the old string is absent", () => {
    const result = applyTextEdit({
      content: "const x = 1",
      oldString: "zzz",
      newString: "2",
    })

    expect(result).toEqual({ ok: false, reason: "not_found" })
  })

  it("refuses an ambiguous edit and reports how many matches were found", () => {
    const result = applyTextEdit({
      content: "a\na\na",
      oldString: "a",
      newString: "b",
    })

    expect(result).toEqual({ ok: false, reason: "ambiguous", count: 3 })
  })

  it("replaces every occurrence under replaceAll and reports the count", () => {
    const result = applyTextEdit({
      content: "a\na\na",
      oldString: "a",
      newString: "b",
      replaceAll: true,
    })

    expect(result).toEqual({ ok: true, content: "b\nb\nb", replacements: 3 })
  })
})
