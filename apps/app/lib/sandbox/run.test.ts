import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SandboxCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// The runner resolves the live instance through the provider seam. A fake
// provider — scripted, no real VM — stands in for Vercel Sandbox so we exercise
// the real runner code path. `vi.hoisted` lets the mock factory below close over
// a mutable holder we can rescript per test.
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
      throw new Error("create not used by the runner")
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

import { runSandboxAction, SandboxStepError, step } from "@/lib/sandbox/run"

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)`. Only the surface the runner touches is implemented;
 * everything else throws so an accidental dependency is loud, not silent.
 */
function fakeSandbox(
  respond: (
    cmd: string,
    args: string[]
  ) => { exitCode: number; stdout?: string; stderr?: string }
): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const runCommand = (cmdOrOpts: unknown, maybeArgs?: string[]) => {
    const cmd =
      typeof cmdOrOpts === "string"
        ? cmdOrOpts
        : (cmdOrOpts as { cmd: string }).cmd
    const args =
      typeof cmdOrOpts === "string"
        ? (maybeArgs ?? [])
        : ((cmdOrOpts as { args?: string[] }).args ?? [])
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
  return {
    name: "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/home/vercel-sandbox",
    domain: notUsed("domain") as never,
    hostPort: notUsed("hostPort") as never,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runSandboxAction", () => {
  it("returns the body's value as a success result", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 })))

    const result = await runSandboxAction("sandbox-a", async () => "done")

    expect(result).toEqual({ success: true, value: "done" })
  })

  it("returns a failure result carrying the error message when the body throws", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 })))

    const result = await runSandboxAction("sandbox-a", async () => {
      throw new Error("clone failed")
    })

    expect(result).toEqual({ success: false, error: "clone failed" })
  })
})

describe("step", () => {
  it("resolves with the command result on exit 0", async () => {
    const sandbox = fakeSandbox(() => ({ exitCode: 0, stdout: "ok" }))

    const result = await step(sandbox, "git", ["status"])

    expect(result.exitCode).toBe(0)
    expect(await result.stdout()).toBe("ok")
  })

  it("throws SandboxStepError on a non-zero exit", async () => {
    const sandbox = fakeSandbox(() => ({
      exitCode: 1,
      stderr: "fatal: not a git repository",
    }))

    await expect(step(sandbox, "git", ["status"])).rejects.toBeInstanceOf(
      SandboxStepError
    )
  })

  it("redacts a GitHub token out of the error it carries", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    const sandbox = fakeSandbox(() => ({
      exitCode: 128,
      stderr: `fatal: unable to access 'https://x-access-token:${token}@github.com/o/r': 403`,
    }))

    const error = await step(sandbox, "git", ["fetch"]).catch(
      (e) => e as SandboxStepError
    )

    expect(error).toBeInstanceOf(SandboxStepError)
    expect(error.stderr).not.toContain(token)
    expect(error.stderr).toContain("[REDACTED]")
  })

  it("truncates very long stderr", async () => {
    const sandbox = fakeSandbox(() => ({
      exitCode: 1,
      stderr: "x".repeat(10_000),
    }))

    const error = await step(sandbox, "npm", ["install"]).catch(
      (e) => e as SandboxStepError
    )

    expect(error.stderr.length).toBeLessThan(10_000)
  })
})

describe("runSandboxAction + step (end to end)", () => {
  it("surfaces a failing step's redacted stderr as a failure result", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    const sandbox = fakeSandbox(() => ({
      exitCode: 128,
      stderr: `remote: error using token ${token}`,
    }))
    fake.setInstance(sandbox)

    const result = await runSandboxAction("sandbox-a", async (s) => {
      await step(s, "git", ["push"])
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})
