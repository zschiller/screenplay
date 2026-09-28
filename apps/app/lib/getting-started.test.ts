import { describe, expect, it } from "vitest"

import { gettingStartedProgress } from "./getting-started"

const repo = { id: "repo-1" }
const branch = (
  id: string,
  status: "creating" | "starting" | "running" | "error" = "starting"
) => ({ id, status, statusMessage: "Installing dependencies…" })

describe("gettingStartedProgress", () => {
  it("starts on Add a project", () => {
    const p = gettingStartedProgress({
      repos: [],
      branches: [],
      iframeLayers: [],
    })
    expect(p).toMatchObject({
      project: false,
      workspace: false,
      frame: false,
      current: "project",
      branch: null,
      frameLayerId: null,
    })
  })

  it("moves to Start a Workspace once a Project is added with none", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [],
      iframeLayers: [],
    })
    expect(p.current).toBe("workspace")
  })

  it("waits on the frame until its Workspace is running", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1")],
      iframeLayers: [{ id: "f1", branchId: "b1" }],
    })
    expect(p).toMatchObject({
      project: true,
      workspace: true,
      frame: false,
      current: "frame",
      frameLayerId: "f1",
    })
    expect(p.branch?.id).toBe("b1")
  })

  it("follows the Workspace that has a frame", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1"), branch("b2")],
      iframeLayers: [{ id: "f2", branchId: "b2" }],
    })
    expect(p.branch?.id).toBe("b2")
    expect(p.frameLayerId).toBe("f2")
  })

  it("isn't done by a running Workspace with no frame", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1", "running")],
      iframeLayers: [],
    })
    expect(p.frame).toBe(false)
    expect(p.frameLayerId).toBeNull()
  })

  it("is done once a frame shows a running Workspace", () => {
    const p = gettingStartedProgress({
      repos: [repo],
      branches: [branch("b1", "running")],
      iframeLayers: [{ id: "f1", branchId: "b1" }],
    })
    expect(p.frame).toBe(true)
    expect(p.current).toBeNull()
  })
})
