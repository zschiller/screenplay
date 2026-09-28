import { describe, expect, it } from "vitest"
import { planResolutionText } from "./resolution"

describe("planResolutionText — the continuation a plan decision lands as", () => {
  it("approve: an explicit 'proceed'", () => {
    expect(planResolutionText({ approved: true })).toBe(
      "Approved the plan. Proceed with the implementation."
    )
  })

  it("reject: the feedback verbatim (trimmed), or a generic revise", () => {
    expect(
      planResolutionText({ approved: false, feedback: " Use a queue. " })
    ).toBe("Use a queue.")
    expect(planResolutionText({ approved: false, feedback: "  " })).toBe(
      "Requested changes to the plan. Please revise."
    )
  })
})
