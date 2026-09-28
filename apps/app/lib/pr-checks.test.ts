import { describe, expect, it } from "vitest"
import { isMergeBlocked, summarizeCheckRuns } from "./pr-checks"

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

describe("isMergeBlocked", () => {
  it("blocks on failing checks", () => {
    expect(isMergeBlocked("unstable", "failing")).toBe(true)
  })

  it("blocks on a conflict or a blocked merge", () => {
    expect(isMergeBlocked("dirty", "passing")).toBe(true)
    expect(isMergeBlocked("blocked", undefined)).toBe(true)
  })

  it("doesn't block a clean PR or one GitHub hasn't computed yet", () => {
    expect(isMergeBlocked("clean", "passing")).toBe(false)
    expect(isMergeBlocked("unknown", "pending")).toBe(false)
    expect(isMergeBlocked(undefined, undefined)).toBe(false)
  })
})
