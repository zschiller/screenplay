import { afterEach, describe, expect, it } from "vitest"
import os from "node:os"

import {
  TerminalSessions,
  type SessionHandle,
  type SessionListener,
} from "@/lib/terminal/local/pty"

// A real PTY-backed transport, so the tests drive an actual `bash` the way the
// ttyd protocol spike validated the daemon: echo a marker and read it back, and
// resize then read `stty size` to prove the geometry reaches the PTY (not just a
// client-side view). Mirrors the PRD's node-pty transport test.

const SHELL = "/bin/bash"

/** A listener that accumulates everything the session emits, for assertions. */
function collector(): SessionListener & { text(): string; exited(): boolean } {
  let text = ""
  let exited = false
  return {
    onData: (d) => {
      text += d
    },
    onExit: () => {
      exited = true
    },
    text: () => text,
    exited: () => exited,
  }
}

/** Poll until `predicate` holds or we time out — output arrives asynchronously. */
async function waitFor(
  predicate: () => boolean,
  { timeout = 4000, step = 25 } = {}
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, step))
  }
}

describe("TerminalSessions", () => {
  const sessions = new TerminalSessions()
  const opened: string[] = []

  function attach(
    key: string,
    listener: SessionListener,
    geom: { columns: number; rows: number } = { columns: 80, rows: 24 }
  ): SessionHandle {
    if (!opened.includes(key)) opened.push(key)
    return sessions.attach({
      key,
      cwd: os.tmpdir(),
      shell: SHELL,
      listener,
      ...geom,
    })
  }

  afterEach(() => {
    for (const key of opened.splice(0)) sessions.kill(key)
  })

  it("round-trips I/O: a marker echoed into the PTY comes back out", async () => {
    const sink = collector()
    const handle = attach("io", sink)
    handle.write("echo MARKER_$((6*7))\r")
    await waitFor(() => sink.text().includes("MARKER_42"))
    expect(sink.text()).toContain("MARKER_42")
  })

  it("does not leak the app's provider secrets into the shell env", async () => {
    const prior = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak"
    try {
      const sink = collector()
      const handle = attach("secrets", sink)
      // `claude` run in a tab must use the user's login, not the app's API key —
      // the sidecar's provider secrets are scrubbed before the PTY inherits env.
      handle.write('echo "KEY=${ANTHROPIC_API_KEY-unset}"\r')
      await waitFor(() => sink.text().includes("KEY=unset"))
      expect(sink.text()).not.toContain("sk-should-not-leak")
    } finally {
      if (prior === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prior
    }
  })

  it("propagates resize to the real PTY (stty size reflects the new geometry)", async () => {
    const sink = collector()
    const handle = attach("resize", sink, { columns: 80, rows: 24 })

    handle.write("stty size\r")
    await waitFor(() => /\b24 80\b/.test(sink.text()))
    expect(sink.text()).toMatch(/\b24 80\b/)

    handle.resize(120, 40)
    handle.write("stty size\r")
    await waitFor(() => /\b40 120\b/.test(sink.text()))
    expect(sink.text()).toMatch(/\b40 120\b/)
  })

  it("survives a reload: the PTY outlives detach and a reattach replays state", async () => {
    const first = collector()
    const handle = attach("reload", first)
    handle.write("echo FIRST_MARK\r")
    await waitFor(() => first.text().includes("FIRST_MARK"))

    // A webview reload tears down the socket — detach, but the PTY must live on.
    handle.detach()
    expect(sessions.has("reload")).toBe(true)
    expect(first.exited()).toBe(false)

    // Reconnect with the same key: the buffer replays the prior output, and the
    // still-running shell answers a new command — proving it's the same process.
    const second = collector()
    const reattached = attach("reload", second)
    await waitFor(() => second.text().includes("FIRST_MARK"))
    expect(second.text()).toContain("FIRST_MARK")

    reattached.write("echo SECOND_MARK\r")
    await waitFor(() => second.text().includes("SECOND_MARK"))
    expect(second.text()).toContain("SECOND_MARK")
  })

  it("kill terminates the PTY and notifies attached listeners", async () => {
    const sink = collector()
    attach("killme", sink)
    await waitFor(() => sessions.has("killme"))

    sessions.kill("killme")
    expect(sessions.has("killme")).toBe(false)
    expect(sink.exited()).toBe(true)
  })

  it("kill on an unknown session is a no-op", () => {
    expect(() => sessions.kill("never-existed")).not.toThrow()
  })
})
