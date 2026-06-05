// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The hook's default probe lives in the sandbox lifecycle module, which pulls
// in server-only DB wiring at import time. These tests inject their own probe,
// so stub the module to keep the import graph (and DATABASE_URL) out of scope.
vi.mock("@/lib/sandbox/lifecycle", () => ({
  probeSandboxUrl: vi.fn().mockResolvedValue(false),
}))

import { useDevServerProbe } from "./use-dev-server-probe"

describe("useDevServerProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts in waiting and does not probe without a URL", async () => {
    const probe = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useDevServerProbe(undefined, { probe, intervalMs: 10, maxProbes: 3 })
    )

    expect(result.current.state).toBe("waiting")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(probe).not.toHaveBeenCalled()
    expect(result.current.state).toBe("waiting")
  })

  it("transitions waiting → ready when the dev server responds", async () => {
    const probe = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useDevServerProbe("http://dev", { probe, intervalMs: 10, maxProbes: 3 })
    )

    expect(result.current.state).toBe("waiting")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe("ready")
    expect(probe).toHaveBeenCalledTimes(1)
    // Ready on the first probe (warm path) — the iframe loaded real content,
    // so the caller must NOT reload it.
    expect(result.current.readyAfterWait).toBe(false)
  })

  it("transitions waiting → ready when the server comes up mid-probe", async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const { result } = renderHook(() =>
      useDevServerProbe("http://dev", { probe, intervalMs: 10, maxProbes: 10 })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(result.current.state).toBe("ready")
    expect(probe).toHaveBeenCalledTimes(3)
    // Earlier probes failed (cold start) — the iframe may have shown the
    // placeholder, so the caller should reload onto the now-live server.
    expect(result.current.readyAfterWait).toBe(true)
  })

  it("transitions waiting → timedout after the probe window elapses", async () => {
    const probe = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() =>
      useDevServerProbe("http://dev", { probe, intervalMs: 10, maxProbes: 3 })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(result.current.state).toBe("timedout")
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it("restarts the probe (timedout → waiting → ready) when retry is called", async () => {
    const probe = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() =>
      useDevServerProbe("http://dev", { probe, intervalMs: 10, maxProbes: 2 })
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(result.current.state).toBe("timedout")

    // The dev server is now reachable; retry should pick it up.
    probe.mockResolvedValue(true)
    act(() => {
      result.current.retry()
    })
    expect(result.current.state).toBe("waiting")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe("ready")
  })
})
