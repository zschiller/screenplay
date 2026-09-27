// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getLocalSetupGateStatus = vi.fn()
vi.mock("@/lib/local-setup/gate-status", () => ({
  getLocalSetupGateStatus: () => getLocalSetupGateStatus(),
}))
vi.mock("@/lib/local-setup/github-skip", () => ({ writeGitHubSkip: vi.fn() }))
// The panels probe the host on mount; the gate's own poll is what's under test.
vi.mock("@/components/home/github-connection-panel", () => ({
  GitHubConnectionPanel: () => null,
}))
vi.mock("@/components/home/harness-setup-panel", () => ({
  HarnessSetupPanel: () => null,
}))

import { LocalSetupGate } from "./local-setup-gate"

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  getLocalSetupGateStatus.mockReset()
})

describe("LocalSetupGate polling", () => {
  it("keeps polling after a failed read, and releases Finish once setup is done", async () => {
    getLocalSetupGateStatus
      .mockRejectedValueOnce(new Error("sidecar restarting"))
      .mockResolvedValue({ harnessSatisfied: true, githubSatisfied: true })

    render(
      <LocalSetupGate
        initiallyBlocked
        initialStatus={{ harnessSatisfied: false, githubSatisfied: false }}
        initiallyGithubSkipped={false}
      >
        <p>the app</p>
      </LocalSetupGate>
    )
    const finish = screen.getByRole("button", { name: "Finish" })
    expect(finish).toHaveProperty("disabled", true)

    // First poll fails…
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(getLocalSetupGateStatus).toHaveBeenCalledTimes(1)
    expect(finish).toHaveProperty("disabled", true)

    // …and the next one still runs, and releases.
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(getLocalSetupGateStatus).toHaveBeenCalledTimes(2)
    expect(finish).toHaveProperty("disabled", false)
  })
})
