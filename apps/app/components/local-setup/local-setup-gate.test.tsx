import { describe, expect, it } from "vitest"

import { finishBlockedReason } from "./local-setup-gate"

describe("finishBlockedReason", () => {
  it("names both steps when neither is done", () => {
    expect(
      finishBlockedReason({ harnessDone: false, githubDone: false })
    ).toMatch(/coding agent.*GitHub/)
  })

  it("names only the coding agent once GitHub is settled", () => {
    const reason = finishBlockedReason({ harnessDone: false, githubDone: true })
    expect(reason).toMatch(/coding agent/)
    expect(reason).not.toMatch(/GitHub/)
  })

  it("names only GitHub once a coding agent is ready", () => {
    const reason = finishBlockedReason({ harnessDone: true, githubDone: false })
    expect(reason).toMatch(/GitHub/)
    expect(reason).not.toMatch(/coding agent/)
  })
})
