import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SandboxCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// The terminal action resolves the live instance through the provider seam. A
// fake provider — scripted, no real VM — stands in for Vercel Sandbox so we
// exercise the real action + runner code path. `vi.hoisted` lets the mock
// factory close over mutable holders we rescript per test.
const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  let getError: unknown = null
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (getError) throw getError
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async () => {
      throw new Error("create not used by the terminal action")
    }),
  }
  return {
    provider,
    setInstance: (i: SandboxInstance) => {
      instance = i
      getError = null
    },
    setGetError: (e: unknown) => {
      getError = e
      instance = null
    },
  }
})

vi.mock("@/lib/sandbox", () => ({ sandboxProvider: fake.provider }))

import { TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import { ensureTerminal } from "@/lib/sandbox/terminal"

type Scripted = { exitCode: number; stdout?: string; stderr?: string }
type Issued = { cmd: string; args: string[]; detached: boolean }

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)` and which records every command issued (with its
 * `detached` flag) into `issued`. Only the surface the action touches is
 * implemented; everything else throws so an accidental dependency is loud.
 */
function fakeSandbox(
  respond: (cmd: string, args: string[]) => Scripted = () => ({ exitCode: 0 }),
): { sandbox: SandboxInstance; issued: Issued[] } {
  const issued: Issued[] = []
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const runCommand = (cmdOrOpts: unknown, maybeArgs?: string[]) => {
    const cmd = typeof cmdOrOpts === "string" ? cmdOrOpts : (cmdOrOpts as { cmd: string }).cmd
    const args =
      typeof cmdOrOpts === "string"
        ? (maybeArgs ?? [])
        : ((cmdOrOpts as { args?: string[] }).args ?? [])
    const detached =
      typeof cmdOrOpts === "string" ? false : Boolean((cmdOrOpts as { detached?: boolean }).detached)
    issued.push({ cmd, args, detached })
    const scripted = respond(cmd, args)
    const result: SandboxCommandResult = {
      exitCode: scripted.exitCode,
      stdout: async () => scripted.stdout ?? "",
      stderr: async () => scripted.stderr ?? "",
      logs: notUsed("logs") as never,
      kill: async () => {},
    }
    return Promise.resolve(result)
  }
  const sandbox: SandboxInstance = {
    name: "fake-sandbox",
    status: "running",
    domain: (port: number) => `https://fake-${port}.example.com`,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    extendTimeout: async () => {},
    snapshot: notUsed("snapshot") as never,
    delete: async () => {},
  }
  return { sandbox, issued }
}

// The action probes whether a daemon is already running by reading the stdout
// of its check command. These scripts model the two outcomes.
const REPORTS_RUNNING = (cmd: string, args: string[]): Scripted =>
  isCheck(args) ? { exitCode: 0, stdout: "running\n" } : { exitCode: 0 }
const REPORTS_STOPPED = (cmd: string, args: string[]): Scripted =>
  isCheck(args) ? { exitCode: 0, stdout: "stopped\n" } : { exitCode: 0 }

/** The liveness probe is the one command that inspects the pidfile. */
function isCheck(args: string[]): boolean {
  return args.some((a) => a.includes("kill -0"))
}

/** The launch is the one detached command that spawns the daemon under setsid. */
function isLaunch(issued: Issued): boolean {
  return issued.detached && issued.args.some((a) => a.includes("setsid"))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("ensureTerminal", () => {
  it("launches the daemon and returns its forwarded-port URL", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_STOPPED)
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a")

    expect(result).toEqual({
      success: true,
      value: { url: `https://fake-${TERMINAL_PORT}.example.com` },
    })
    // The daemon wasn't running, so the action launched it.
    expect(issued.some(isLaunch)).toBe(true)
  })

  it("reuses a running daemon without launching a duplicate", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_RUNNING)
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a")

    // Same URL comes back…
    expect(result).toEqual({
      success: true,
      value: { url: `https://fake-${TERMINAL_PORT}.example.com` },
    })
    // …but no second daemon was started.
    expect(issued.some(isLaunch)).toBe(false)
  })

  it("returns a redacted failure when a step fails, without spilling a token", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    // The install step exits non-zero with a token in its stderr.
    const { sandbox } = fakeSandbox(() => ({
      exitCode: 1,
      stderr: `curl: (22) auth failed using token ${token}`,
    }))
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})
