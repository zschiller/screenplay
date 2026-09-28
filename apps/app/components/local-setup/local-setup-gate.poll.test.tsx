// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getLocalSetupGateStatus = vi.fn()
vi.mock("@/lib/local-setup/gate-status", () => ({
  getLocalSetupGateStatus: () => getLocalSetupGateStatus(),
}))
vi.mock("@/lib/local-setup/github-skip", () => ({ writeGitHubSkip: vi.fn() }))
// The steps probe the host on mount; the gate's own poll is what's under test.
vi.mock("./agent-step", () => ({ AgentStep: () => null }))
vi.mock("./github-step", () => ({ GitHubStep: () => null }))

let pathname = "/"
const push = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}))
const createRoom = vi.fn()
vi.mock("@/lib/rooms-actions", () => ({
  createRoom: (name: string) => createRoom(name),
}))
vi.mock("@/lib/yjs-host/client", () => ({ prewarmRoom: vi.fn() }))

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
  createRoom.mockReset()
  push.mockReset()
  pathname = "/"
  localStorage.clear()
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

  it("Finish opens a new canvas marked for the getting-started checklist", async () => {
    createRoom.mockResolvedValue({ id: "room-first" })
    const gate = () => (
      <LocalSetupGate
        initiallyBlocked
        initialStatus={{ harnessSatisfied: true, githubSatisfied: true }}
        initiallyGithubSkipped={false}
      >
        <p>the app</p>
      </LocalSetupGate>
    )
    const { rerender } = render(gate())

    await act(async () => {
      screen.getByRole("button", { name: "Finish" }).click()
    })
    expect(createRoom).toHaveBeenCalledWith("Untitled")
    expect(push).toHaveBeenCalledWith("/room-first")
    expect(localStorage.getItem("screenplay:getting-started-canvas")).toBe(
      "room-first"
    )
    // The gate holds until the route has moved, so home never flashes.
    expect(screen.queryByText("the app")).toBeNull()

    pathname = "/room-first"
    rerender(gate())
    expect(screen.getByText("the app")).toBeTruthy()
  })
})
