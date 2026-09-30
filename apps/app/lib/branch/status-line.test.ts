import { describe, expect, it } from "vitest"

import {
  failureTitle,
  formatElapsed,
  planPendingBranchIds,
  workspaceStatusLine,
} from "@/lib/branch/status-line"

const idle = { agentWorking: false }

describe("workspaceStatusLine", () => {
  it("names the setup step while provisioning", () => {
    expect(
      workspaceStatusLine(
        { status: "starting", statusMessage: "Installing dependencies…" },
        idle
      )
    ).toEqual({ kind: "progress", step: "Installing dependencies" })
  })

  it("falls back to a generic step when none is on record", () => {
    expect(workspaceStatusLine({ status: "creating" }, idle)).toEqual({
      kind: "progress",
      step: "Creating workspace",
    })
    expect(
      workspaceStatusLine({ status: "starting", statusMessage: "" }, idle)
    ).toEqual({ kind: "progress", step: "Starting" })
  })

  it("titles a failure by the step that was running", () => {
    expect(
      workspaceStatusLine(
        {
          status: "error",
          statusMessage: "Installing dependencies…",
          error: "exit 1",
        },
        idle
      )
    ).toEqual({
      kind: "error",
      title: "Installing dependencies failed",
      detail: "exit 1",
    })
  })

  it("treats a stray error as a failure even when the status says otherwise", () => {
    expect(
      workspaceStatusLine({ status: "running", error: "boom" }, idle)
    ).toMatchObject({ kind: "error", title: "Setup failed", detail: "boom" })
  })

  it("reads Agent working while a turn is in flight", () => {
    expect(
      workspaceStatusLine({ status: "running" }, { agentWorking: true })
    ).toEqual({ kind: "idle", state: "working", text: "Agent working" })
  })

  it("reads Ready or Stopped otherwise", () => {
    expect(workspaceStatusLine({ status: "running" }, idle)).toEqual({
      kind: "idle",
      state: "ready",
      text: "Ready",
    })
    expect(workspaceStatusLine({ status: "stopped" }, idle)).toEqual({
      kind: "idle",
      state: "stopped",
      text: "Stopped",
    })
  })

  it("reads Needs you while a plan waits for approval", () => {
    const waiting = {
      kind: "idle",
      state: "needs-you",
      text: "Plan waiting for approval",
    }
    expect(
      workspaceStatusLine(
        { status: "running" },
        { agentWorking: false, planPending: true }
      )
    ).toEqual(waiting)
    expect(
      workspaceStatusLine(
        { status: "stopped" },
        { agentWorking: false, planPending: true }
      )
    ).toEqual(waiting)
    // A new turn after the plan reads as working.
    expect(
      workspaceStatusLine(
        { status: "running" },
        { agentWorking: true, planPending: true }
      )
    ).toMatchObject({ state: "working" })
  })

  it("reads Needs you for a blocked PR, and Ready for a healthy one", () => {
    expect(
      workspaceStatusLine(
        { status: "running", prState: "open", prBlocked: true },
        idle
      )
    ).toEqual({ kind: "idle", state: "needs-you", text: "Merge blocked" })
    expect(
      workspaceStatusLine({ status: "running", prState: "open" }, idle)
    ).toMatchObject({ state: "ready" })
    expect(
      workspaceStatusLine(
        { status: "running", prState: "merged", prBlocked: true },
        idle
      )
    ).toMatchObject({ state: "ready" })
  })

  it("reads Done once a member marked it done, whatever the sandbox says", () => {
    const done = { kind: "idle", state: "done", text: "Done" }
    expect(workspaceStatusLine({ status: "stopped", doneAt: 1 }, idle)).toEqual(
      done
    )
    expect(
      workspaceStatusLine({ status: "error", error: "x", doneAt: 1 }, idle)
    ).toEqual(done)
  })
})

describe("planPendingBranchIds", () => {
  it("collects only pending plans", () => {
    expect(
      planPendingBranchIds([
        { branchId: "a", status: "pending" },
        { branchId: "b", status: "approved" },
        { branchId: "c", status: "rejected" },
      ])
    ).toEqual(new Set(["a"]))
  })
})

describe("failureTitle", () => {
  it("strips either ellipsis form", () => {
    expect(failureTitle("Cloning repository...")).toBe(
      "Cloning repository failed"
    )
    expect(failureTitle(undefined)).toBe("Setup failed")
  })
})

describe("formatElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(40_900)).toBe("40s")
    expect(formatElapsed(125_000)).toBe("2m 05s")
  })
})
