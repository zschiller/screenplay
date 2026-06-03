import { describe, expect, it } from "vitest"
import {
  appendClonedRow,
  focusAfterRemove,
  initialRows,
  removeRow,
  summarizeRow,
  type ComposerRow,
} from "@/lib/composer-rows"

// Deterministic key factory so tests can assert on identity without coupling to
// any global counter or randomness in the module itself.
function keySeq() {
  let n = 0
  return () => `k${n++}`
}

describe("initialRows", () => {
  it("opens on a single fresh row with the chosen base, default model, no prompt", () => {
    expect(initialRows("main", "claude-opus-4-8", keySeq())).toEqual([
      {
        key: "k0",
        baseBranch: "main",
        model: "claude-opus-4-8",
        prompt: "",
        planMode: false,
      },
    ])
  })
})

describe("appendClonedRow", () => {
  it("clones the previous row's base and model with an empty prompt", () => {
    const rows = initialRows("feat/x", "claude-sonnet-4-6", keySeq())
    const next = appendClonedRow(rows, keySeq())

    expect(next).toHaveLength(2)
    expect(next[1]).toEqual({
      key: "k0",
      baseBranch: "feat/x",
      model: "claude-sonnet-4-6",
      prompt: "",
      planMode: false,
    })
  })

  it("clones the LAST row, not the first, so chained adds carry edits forward", () => {
    const make = keySeq()
    let rows: ComposerRow[] = initialRows("main", "opus", make)
    rows[0] = { ...rows[0]!, baseBranch: "release", model: "haiku" }
    rows = appendClonedRow(rows, make)

    expect(rows[1]).toMatchObject({ baseBranch: "release", model: "haiku" })
  })

  it("resets the cloned row's prompt and plan-mode regardless of the source", () => {
    const rows: ComposerRow[] = [
      {
        key: "a",
        baseBranch: "main",
        model: "opus",
        prompt: "do the thing",
        planMode: true,
      },
    ]
    const next = appendClonedRow(rows, keySeq())

    expect(next[1]).toMatchObject({ prompt: "", planMode: false })
  })

  it("gives each appended row a distinct key", () => {
    const make = keySeq()
    let rows = initialRows("main", "opus", make)
    rows = appendClonedRow(rows, make)
    rows = appendClonedRow(rows, make)

    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it("does not mutate the input array", () => {
    const rows = initialRows("main", "opus", keySeq())
    const snapshot = [...rows]
    appendClonedRow(rows, keySeq())
    expect(rows).toEqual(snapshot)
  })
})

describe("removeRow", () => {
  it("removes the row at the given index", () => {
    const rows: ComposerRow[] = [
      { key: "a", baseBranch: "main", model: "m", prompt: "", planMode: false },
      { key: "b", baseBranch: "x", model: "m", prompt: "", planMode: false },
      { key: "c", baseBranch: "y", model: "m", prompt: "", planMode: false },
    ]
    expect(removeRow(rows, 1).map((r) => r.key)).toEqual(["a", "c"])
  })

  it("never drops below a single row", () => {
    const rows = initialRows("main", "opus", keySeq())
    expect(removeRow(rows, 0)).toBe(rows)
  })
})

describe("focusAfterRemove", () => {
  it("shifts focus back when an earlier row is removed", () => {
    expect(focusAfterRemove(2, 0, 3)).toBe(1)
  })

  it("shifts focus back when the focused row itself is removed", () => {
    expect(focusAfterRemove(2, 2, 2)).toBe(1)
  })

  it("keeps focus put when a later row is removed", () => {
    expect(focusAfterRemove(0, 2, 3)).toBe(0)
  })

  it("clamps into range and never goes negative", () => {
    expect(focusAfterRemove(0, 0, 1)).toBe(0)
  })
})

describe("summarizeRow", () => {
  it("reads as base · model · prompt preview", () => {
    expect(
      summarizeRow(
        { baseBranch: "main", model: "id", prompt: "add a settings page" },
        "Claude Opus 4.8"
      )
    ).toBe("main · Claude Opus 4.8 · add a settings page")
  })

  it("labels an empty prompt as a bare branch", () => {
    expect(
      summarizeRow({ baseBranch: "main", model: "id", prompt: "  " }, "Opus")
    ).toBe("main · Opus · bare branch")
  })

  it("truncates a long prompt with an ellipsis", () => {
    const long = "x".repeat(200)
    const summary = summarizeRow(
      { baseBranch: "main", model: "id", prompt: long },
      "Opus"
    )
    expect(summary.endsWith("…")).toBe(true)
    expect(summary.length).toBeLessThan(long.length)
  })
})
