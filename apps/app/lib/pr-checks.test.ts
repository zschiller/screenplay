import { describe, expect, it } from "vitest"
import { summarizeCheckRuns } from "./pr-checks"

const run = (status: string, conclusion: string | null = null) => ({
  status,
  conclusion,
})

describe("summarizeCheckRuns", () => {
  it("is undefined when the commit has no checks", () => {
    expect(summarizeCheckRuns([])).toBeUndefined()
  })

  it("is passing when every run completed without failing", () => {
    expect(
      summarizeCheckRuns([
        run("completed", "success"),
        run("completed", "skipped"),
        run("completed", "neutral"),
      ])
    ).toBe("passing")
  })

  it("is pending while a run is still going", () => {
    expect(
      summarizeCheckRuns([run("completed", "success"), run("in_progress")])
    ).toBe("pending")
  })

  it("is failing when any run failed, even with others still going", () => {
    expect(
      summarizeCheckRuns([run("queued"), run("completed", "timed_out")])
    ).toBe("failing")
  })
})
