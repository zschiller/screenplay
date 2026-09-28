import { describe, expect, it } from "vitest"

import {
  failureTitle,
  formatElapsed,
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

  it("puts a working agent ahead of the PR", () => {
    expect(
      workspaceStatusLine(
        { status: "running" },
        { agentWorking: true, pr: { number: 482, state: "open" } }
      )
    ).toEqual({ kind: "idle", text: "Agent working" })
  })

  it("shows the PR and its state", () => {
    expect(
      workspaceStatusLine(
        { status: "running" },
        { agentWorking: false, pr: { number: 482, state: "merged" } }
      )
    ).toEqual({ kind: "idle", text: "PR #482 · merged" })
  })

  it("reads Ready or Stopped otherwise", () => {
    expect(workspaceStatusLine({ status: "running" }, idle)).toEqual({
      kind: "idle",
      text: "Ready",
    })
    expect(workspaceStatusLine({ status: "stopped" }, idle)).toEqual({
      kind: "idle",
      text: "Stopped",
    })
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
