import { describe, expect, it } from "vitest"

import { resolveFrameStage, type FrameStageInput } from "./frame-stage"

const base: FrameStageInput = {
  status: "running",
  hasPreview: true,
  probe: "waiting",
  contentReady: false,
  recoveryExhausted: false,
}

const stage = (patch: Partial<FrameStageInput>) =>
  resolveFrameStage({ ...base, ...patch })

describe("resolveFrameStage", () => {
  it("shows no Workspace when the frame has none", () => {
    expect(stage({ status: undefined, contentReady: true })).toBe("unassigned")
  })

  it("walks a Workspace from booting through starting to the live page", () => {
    expect(stage({ status: "creating", hasPreview: false })).toBe("booting")
    expect(stage({ status: "starting" })).toBe("starting")
    expect(stage({ status: "running", probe: "waiting" })).toBe("starting")
    expect(stage({ status: "running", probe: "ready" })).toBe("starting")
    expect(stage({ status: "running", contentReady: true })).toBeNull()
  })

  it("holds a running Workspace with no preview URL yet on starting", () => {
    expect(stage({ hasPreview: false, probe: "timedout" })).toBe("starting")
  })

  it("lets a real page win over a status that lags behind it", () => {
    expect(stage({ status: "creating", contentReady: true })).toBeNull()
    expect(stage({ status: "starting", contentReady: true })).toBeNull()
  })

  it("covers the frame for a stopped or errored Workspace, page or not", () => {
    expect(stage({ status: "stopped", contentReady: true })).toBe("stopped")
    expect(stage({ status: "error", contentReady: true })).toBe(
      "workspace-failed"
    )
  })

  it("fails the preview when the probe times out or recovery gives up", () => {
    expect(stage({ probe: "timedout" })).toBe("preview-failed")
    expect(stage({ probe: "ready", recoveryExhausted: true })).toBe(
      "preview-failed"
    )
  })
})
