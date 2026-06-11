import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  installLocalSandboxReaper,
  reapLocalSandboxProcessesSync,
} from "./reaper"

describe("reapLocalSandboxProcessesSync", () => {
  let root: string
  let kills: Array<{ pid: number; signal: string }>
  const kill = (pid: number, signal: NodeJS.Signals) => {
    kills.push({ pid, signal })
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-test-"))
    kills = []
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const writePidfile = (sandbox: string, file: string, content: string) => {
    const dir = path.join(root, sandbox)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }

  it("group-kills every recorded pid and removes the pidfiles", () => {
    writePidfile("sp-one", "dev.pid", "12345\n")
    writePidfile("sp-one", "proxy.pid", "12346\n")
    writePidfile("sp-two", "dev.pid", "23456\n")

    reapLocalSandboxProcessesSync({ root, kill })

    // The recorded pid is a setsid session leader: the group form (-pid) takes
    // down the whole tree, the plain form is the non-leader fallback.
    for (const pid of [12345, 12346, 23456]) {
      expect(kills).toContainEqual({ pid: -pid, signal: "SIGKILL" })
      expect(kills).toContainEqual({ pid, signal: "SIGKILL" })
    }
    expect(fs.existsSync(path.join(root, "sp-one", "dev.pid"))).toBe(false)
    expect(fs.existsSync(path.join(root, "sp-one", "proxy.pid"))).toBe(false)
    expect(fs.existsSync(path.join(root, "sp-two", "dev.pid"))).toBe(false)
  })

  it("never signals from a corrupt or low pidfile but still removes it", () => {
    writePidfile("sp-bad", "dev.pid", "not-a-pid")
    // pid 1 / 0 / -1 would be catastrophic targets (init, own group, everything)
    writePidfile("sp-bad", "proxy.pid", "1")
    writePidfile("sp-bad", "terminal.pid", "0")

    reapLocalSandboxProcessesSync({ root, kill })

    expect(kills).toEqual([])
    expect(fs.readdirSync(path.join(root, "sp-bad"))).toEqual([])
  })

  it("leaves non-pidfile state (logs) alone", () => {
    writePidfile("sp-one", "dev.pid", "12345")
    writePidfile("sp-one", "sandbox.log", "some output")

    reapLocalSandboxProcessesSync({ root, kill })

    expect(fs.existsSync(path.join(root, "sp-one", "sandbox.log"))).toBe(true)
  })

  it("is a no-op when the state root does not exist", () => {
    expect(() =>
      reapLocalSandboxProcessesSync({ root: path.join(root, "missing"), kill })
    ).not.toThrow()
    expect(kills).toEqual([])
  })

  it("survives a dead pid (kill throws) and still cleans up", () => {
    writePidfile("sp-one", "dev.pid", "12345")
    const throwingKill = () => {
      throw new Error("ESRCH")
    }

    reapLocalSandboxProcessesSync({ root, kill: throwingKill })

    expect(fs.existsSync(path.join(root, "sp-one", "dev.pid"))).toBe(false)
  })
})

describe("installLocalSandboxReaper", () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-test-"))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  /** A fake process: an EventEmitter with the exit/kill surface the reaper uses. */
  const fakeProc = () => {
    const emitter = new EventEmitter() as EventEmitter & {
      exit: (code: number) => void
    }
    emitter.exit = vi.fn(() => {
      emitter.emit("exit")
    })
    return emitter as unknown as NodeJS.Process & {
      exit: ReturnType<typeof vi.fn>
    }
  }

  it("sweeps stale pidfiles at install (the force-killed-sidecar recovery)", () => {
    const dir = path.join(root, "sp-stale")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "dev.pid"), "12345")
    const kills: number[] = []

    installLocalSandboxReaper({
      root,
      kill: (pid) => kills.push(pid),
      proc: fakeProc(),
    })

    expect(kills).toContain(-12345)
    expect(fs.existsSync(path.join(dir, "dev.pid"))).toBe(false)
  })

  it("sweeps again from the exit hook, and SIGTERM routes through exit", () => {
    const proc = fakeProc()
    const kills: number[] = []
    installLocalSandboxReaper({ root, kill: (pid) => kills.push(pid), proc })

    // A dev server launched *after* boot — only the exit sweep can see it.
    const dir = path.join(root, "sp-live")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "dev.pid"), "54321")

    // Node's default SIGTERM termination skips "exit" listeners; the installed
    // handler must route it through process.exit so the sweep runs.
    proc.emit("SIGTERM")

    expect(proc.exit).toHaveBeenCalledWith(0)
    expect(kills).toContain(-54321)
    expect(fs.existsSync(path.join(dir, "dev.pid"))).toBe(false)
  })

  it("installs once per process", () => {
    const proc = fakeProc()
    installLocalSandboxReaper({ root, kill: () => {}, proc })
    installLocalSandboxReaper({ root, kill: () => {}, proc })

    expect(proc.listenerCount("exit")).toBe(1)
    expect(proc.listenerCount("SIGTERM")).toBe(1)
  })
})
