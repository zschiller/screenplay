import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  HibernatingSandbox,
  SandboxCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// The inspect actions resolve the live instance through the provider seam (via
// the runner). A fake provider — scripted, no real VM — stands in for Vercel
// Sandbox so we exercise the real action + runner code path. `vi.hoisted` lets
// the mock factory below close over a mutable holder we rescript per test.
const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async () => {
      throw new Error("create not used by inspect actions")
    }),
  }
  return {
    provider,
    setInstance: (i: SandboxInstance) => {
      instance = i
    },
  }
})

// Keep the real portable-liveness predicate (it keys on the fake's isRunning),
// mirroring `lib/sandbox/types.ts`; faking it would defeat the branch under test.
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: fake.provider,
  isSandboxRunning: (s: { isRunning?: () => boolean }) =>
    typeof s?.isRunning === "function" ? s.isRunning() : true,
}))

// `crawlRoutes` asks an LLM to classify a file listing into routes. The model
// call is an external boundary — fake it so the test pins the action's parsing
// + result-shaping, not the model. `generateText` is rescripted per test.
const generateText = vi.hoisted(() => vi.fn())
vi.mock("ai", () => ({ generateText }))
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
  DEFAULT_MODEL: "test-model",
}))

import { crawlRoutes, getSandboxLogs } from "@/lib/sandbox/inspect"

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)`. Only the surface the runner touches is implemented;
 * everything else throws so an accidental dependency is loud, not silent.
 */
function fakeSandbox(
  respond: (cmd: string, args: string[]) => { exitCode: number; stdout?: string; stderr?: string },
  status = "running",
): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const runCommand = (cmdOrOpts: unknown, maybeArgs?: string[]) => {
    const cmd = typeof cmdOrOpts === "string" ? cmdOrOpts : (cmdOrOpts as { cmd: string }).cmd
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
  const sandbox: SandboxInstance = {
    name: "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/home/vercel-sandbox",
    domain: notUsed("domain") as never,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
  ;(sandbox as HibernatingSandbox).isRunning = () => status === "running"
  return sandbox
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getSandboxLogs", () => {
  it("returns the tailed log content as a success value on exit 0", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0, stdout: "line a\nline b\n" })))

    const result = await getSandboxLogs("sandbox-a")

    expect(result).toEqual({ success: true, value: "line a\nline b\n" })
  })

  it("returns empty content without running a command when the sandbox is not running", async () => {
    fake.setInstance(
      fakeSandbox(() => {
        throw new Error("runCommand should not be called when the sandbox is stopped")
      }, "stopped"),
    )

    const result = await getSandboxLogs("sandbox-a")

    expect(result).toEqual({ success: true, value: "" })
  })
})

describe("crawlRoutes", () => {
  it("returns the LLM-discovered routes as a success value", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0, stdout: "app/page.tsx\napp/about/page.tsx\n" })))
    generateText.mockResolvedValue({
      text: '[{"route":"/","label":"Home"},{"route":"/about","label":"About"}]',
    })

    const result = await crawlRoutes("sandbox-a")

    expect(result).toEqual({
      success: true,
      value: [
        { route: "/", label: "Home" },
        { route: "/about", label: "About" },
      ],
    })
  })

  it("defaults to a home route without calling the LLM when the file listing is empty", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0, stdout: "  \n" })))

    const result = await crawlRoutes("sandbox-a")

    expect(result).toEqual({ success: true, value: [{ route: "/", label: "Home" }] })
    expect(generateText).not.toHaveBeenCalled()
  })

  it("returns a failure result when the file-listing command exits non-zero", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 1, stderr: "find: cannot access" })))

    const result = await crawlRoutes("sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("find: cannot access")
  })

  it("redacts a GitHub token out of a failure error", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 1, stderr: `find failed using token ${token}` })),
    )

    const result = await crawlRoutes("sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})
