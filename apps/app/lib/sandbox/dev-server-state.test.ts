import { describe, expect, it } from "vitest"

import {
  FAILURES_TO_CRASH,
  STARTUP_GRACE_MS,
  canControlDevServer,
  nextPreviewHealth,
  resolveDevServerState,
  startPreviewHealth,
  type PreviewHealth,
} from "@/lib/sandbox/dev-server-state"

describe("resolveDevServerState", () => {
  it("is running in a running Sandbox whose preview answers", () => {
    expect(resolveDevServerState({ status: "running" }, false)).toBe("running")
  })

  it("is stopped once someone stopped it, whatever the probe says", () => {
    const agent = { status: "running" as const, devServerStoppedAt: 1 }
    expect(resolveDevServerState(agent, false)).toBe("stopped")
    expect(resolveDevServerState(agent, true)).toBe("stopped")
  })

  it("is crashed when the preview keeps failing and nobody stopped it", () => {
    expect(resolveDevServerState({ status: "running" }, true)).toBe("crashed")
  })

  it("follows the Sandbox when it isn't running", () => {
    expect(resolveDevServerState({ status: "creating" }, true)).toBe("starting")
    expect(resolveDevServerState({ status: "starting" }, true)).toBe("starting")
    expect(resolveDevServerState({ status: "stopped" }, false)).toBe("stopped")
    expect(resolveDevServerState({ status: "error" }, false)).toBe("crashed")
  })

  it("only offers controls inside a running Sandbox", () => {
    expect(canControlDevServer({ status: "running" })).toBe(true)
    expect(canControlDevServer({ status: "stopped" })).toBe(false)
    expect(canControlDevServer({ status: "starting" })).toBe(false)
  })
})

describe("preview health", () => {
  const run = (health: PreviewHealth, results: boolean[], now: number) =>
    results.reduce((h, answered) => nextPreviewHealth(h, answered, now), health)

  it("fails after a run of failed probes with no launch to wait on", () => {
    const failed = Array<boolean>(FAILURES_TO_CRASH).fill(false)
    expect(run(startPreviewHealth(), failed.slice(1), 0).failing).toBe(false)
    expect(run(startPreviewHealth(), failed, 0).failing).toBe(true)
  })

  it("gives a fresh launch its grace period", () => {
    const launchedAt = 1_000
    const health = startPreviewHealth(launchedAt)
    expect(
      run(health, [false, false, false], launchedAt + 10_000).failing
    ).toBe(false)
    expect(
      run(health, [false, false], launchedAt + STARTUP_GRACE_MS).failing
    ).toBe(true)
  })

  it("ends the grace once the preview has answered", () => {
    const launchedAt = 1_000
    const health = run(startPreviewHealth(launchedAt), [true], launchedAt)
    expect(run(health, [false, false], launchedAt + 5_000).failing).toBe(true)
  })

  it("recovers on the next answer", () => {
    const crashed = run(startPreviewHealth(), [false, false], 0)
    expect(nextPreviewHealth(crashed, true, 0).failing).toBe(false)
  })
})
