import { afterEach, describe, expect, it, vi } from "vitest"

import { SHELL_PID_ENV_VAR, watchParentShell } from "./parent-watch"

afterEach(() => {
  vi.useRealTimers()
})

describe("watchParentShell", () => {
  it("does nothing when the shell pid is unset, non-numeric, or <= 1", () => {
    expect(watchParentShell({})).toBeUndefined()
    expect(watchParentShell({ [SHELL_PID_ENV_VAR]: "nope" })).toBeUndefined()
    // launchd (pid 1) means already reparented — nothing to watch.
    expect(watchParentShell({ [SHELL_PID_ENV_VAR]: "1" })).toBeUndefined()
  })

  it("does not exit while the shell is alive", () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    watchParentShell(
      { [SHELL_PID_ENV_VAR]: "4242" },
      { isAlive: () => true, exit, intervalMs: 100 }
    )
    vi.advanceTimersByTime(500)
    expect(exit).not.toHaveBeenCalled()
  })

  it("exits 0 once the shell is gone", () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    let alive = true
    watchParentShell(
      { [SHELL_PID_ENV_VAR]: "4242" },
      { isAlive: () => alive, exit, intervalMs: 100 }
    )
    vi.advanceTimersByTime(100)
    expect(exit).not.toHaveBeenCalled()

    alive = false
    vi.advanceTimersByTime(100)
    expect(exit).toHaveBeenCalledWith(0)
  })
})
