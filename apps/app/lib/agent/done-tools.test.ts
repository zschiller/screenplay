import { describe, expect, it } from "vitest"

import {
  buildDoneTools,
  MARKED_DONE_RESULT,
  type DoneState,
} from "./done-tools"

// `mark_done` (#1705) over fake ports: it marks the chat done only after its
// PR merged or closed, with nothing open and no word from a person waiting.
function harness(state: Partial<DoneState> | null) {
  const marks: string[] = []
  const tools = buildDoneTools({
    state: async () =>
      state && {
        done: false,
        pr: { number: 482, state: "merged" },
        openPastPr: null,
        personMessage: false,
        ...state,
      },
    markDone: async () => {
      marks.push("done")
    },
  })
  const call = () =>
    tools.mark_done.execute!(
      { reason: "#482 merged and nothing is waiting on you." },
      { toolCallId: "t1", messages: [], context: {} }
    ) as Promise<string>
  return { call, marks }
}

describe("mark_done", () => {
  it("marks the chat done once its PR merged", async () => {
    const { call, marks } = harness({})
    expect(await call()).toBe(MARKED_DONE_RESULT)
    expect(marks).toEqual(["done"])
  })

  it("marks it done once its PR closed", async () => {
    const { call, marks } = harness({ pr: { number: 482, state: "closed" } })
    expect(await call()).toBe(MARKED_DONE_RESULT)
    expect(marks).toEqual(["done"])
  })

  it("refuses while the PR is open", async () => {
    const { call, marks } = harness({ pr: { number: 482, state: "open" } })
    expect(await call()).toBe(
      "Not marked done: pull request #482 is still open."
    )
    expect(marks).toEqual([])
  })

  it("refuses with no PR at all", async () => {
    const { call, marks } = harness({ pr: null })
    expect(await call()).toMatch(/^Not marked done: this chat has no pull/)
    expect(marks).toEqual([])
  })

  it("refuses while an earlier PR is still open", async () => {
    const { call, marks } = harness({ openPastPr: 470 })
    expect(await call()).toBe(
      "Not marked done: pull request #470 is still open."
    )
    expect(marks).toEqual([])
  })

  it("refuses when a person wrote during the turn", async () => {
    const { call, marks } = harness({ personMessage: true })
    expect(await call()).toMatch(/^Not marked done: the user sent a message/)
    expect(marks).toEqual([])
  })

  it("does nothing to a chat already done, or gone", async () => {
    const done = harness({ done: true })
    expect(await done.call()).toBe("This chat is already done.")
    const gone = harness(null)
    expect(await gone.call()).toMatch(/chat is gone/)
    expect([...done.marks, ...gone.marks]).toEqual([])
  })
})
