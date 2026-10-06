import { describe, expect, it } from "vitest"

import { setupProgress } from "@/lib/branch/setup-steps"
import type { BranchData } from "@/lib/types"

type Branch = Pick<
  BranchData,
  "status" | "statusMessage" | "codeReady" | "error"
>

const rows = (branch: Branch) =>
  setupProgress(branch)?.steps.map((s) => `${s.state} ${s.label}`) ?? null

describe("setupProgress", () => {
  it("lists a new chat’s branch, clone and git, ticking off each", () => {
    expect(
      rows({ status: "creating", statusMessage: "Setting up the code…" })
    ).toEqual([
      "now Creating the branch",
      "todo Cloning repository",
      "todo Configuring git",
    ])
    expect(
      rows({ status: "creating", statusMessage: "Cloning repository…" })
    ).toEqual([
      "done Branch created",
      "now Cloning repository",
      "todo Configuring git",
    ])
    expect(
      rows({ status: "creating", statusMessage: "Configuring git…" })
    ).toEqual([
      "done Branch created",
      "done Repository cloned",
      "now Configuring git",
    ])
  })

  it("starts a new chat on its first step before any message", () => {
    expect(rows({ status: "creating" })?.[0]).toBe("now Creating the branch")
  })

  it("ends once the code is ready", () => {
    expect(
      rows({
        status: "creating",
        statusMessage: "Installing dependencies…",
        codeReady: true,
      })
    ).toBeNull()
    expect(rows({ status: "running" })).toBeNull()
    expect(rows({ status: "stopped" })).toBeNull()
  })

  it("lists Recreate’s clone and git, without the branch", () => {
    expect(
      rows({ status: "starting", statusMessage: "Setting up the code again…" })
    ).toEqual(["now Cloning repository", "todo Configuring git"])
    expect(
      rows({ status: "starting", statusMessage: "Configuring git…" })
    ).toEqual(["done Repository cloned", "now Configuring git"])
  })

  it("shows a restart, Start or Reopen as one step", () => {
    for (const statusMessage of ["Starting preview…", "Starting…", undefined])
      expect(rows({ status: "starting", statusMessage })).toEqual([
        "now Restoring the code",
      ])
  })

  it("marks the step that failed before the code was ready", () => {
    const progress = setupProgress({
      status: "error",
      statusMessage: "Cloning repository…",
      error: "repository not found",
    })
    expect(progress?.steps.map((s) => `${s.state} ${s.label}`)).toEqual([
      "done Branch created",
      "failed Cloning repository failed",
      "todo Configuring git",
    ])
    expect(progress?.error).toBe("repository not found")
  })

  it("leaves a failure after the code was ready, or a failed restart, alone", () => {
    expect(
      rows({
        status: "error",
        statusMessage: "Installing dependencies…",
        codeReady: true,
      })
    ).toBeNull()
    expect(
      rows({ status: "error", statusMessage: "Installing dependencies…" })
    ).toBeNull()
    expect(
      rows({ status: "error", statusMessage: "Starting preview…" })
    ).toBeNull()
  })
})
