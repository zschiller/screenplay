import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SandboxCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// A GitHub token the sandbox would have baked into its origin URL — the exact
// thing a `read_file .env` / `.git/config` could spill to other room
// collaborators if the output weren't scrubbed.
const TOKEN = "ghp_0123456789abcdefABCDEF0123456789abcd"

const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async () => {
      throw new Error("create not used")
    }),
  }
  return {
    provider,
    setInstance: (i: SandboxInstance) => {
      instance = i
    },
  }
})

vi.mock("@/lib/sandbox", () => ({ sandboxProvider: fake.provider }))
vi.mock("@/lib/auth-helpers", () => ({ getGitHubTokenForUser: vi.fn(async () => null) }))
vi.mock("@/lib/github-pr", () => ({ createGitHubPr: vi.fn() }))
// The shared read tool + document tools import yjs/server, which reads
// LIVEBLOCKS_SECRET_KEY at import. Stub the seam so the assembly is unit-testable.
vi.mock("@/lib/yjs/server", () => ({
  readRoomDoc: vi.fn(async () => null),
  mutateRoomDoc: vi.fn(async () => {}),
}))

import { toolsetFor, withRedactedOutput, type ToolTarget } from "@/lib/agent/toolset"
import type { ToolContext } from "@/lib/agent/tools"

const sandboxCtx: ToolContext = { sandboxName: "sandbox-a", roomId: "room-1", userId: "user-1" }
const sandboxTarget: ToolTarget = { kind: "sandbox", roomId: "room-1", sandbox: sandboxCtx }

function fakeSandboxReturning(content: string): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const cmd: SandboxCommandResult = {
    exitCode: 0,
    stdout: async () => content,
    stderr: async () => "",
    logs: notUsed("logs") as never,
    kill: async () => {},
  }
  return {
    name: "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/root",
    domain: notUsed("domain") as never,
    runCommand: (async () => cmd) as SandboxInstance["runCommand"],
    writeFiles: async () => {},
    readFileToBuffer: async () => Buffer.from(content, "utf-8"),
    delete: async () => {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("toolsetFor (sandbox)", () => {
  it("redacts a GitHub token from read_file output — closing the leak structurally", async () => {
    fake.setInstance(fakeSandboxReturning(`TOKEN=${TOKEN}\n`))

    const tools = toolsetFor(sandboxTarget)
    const out = await tools.read_file.execute!({ path: ".env" }, {} as never)

    expect(out).not.toContain(TOKEN)
    expect(out).toContain("[REDACTED]")
  })

  it("redacts a GitHub token from grep output — new tools inherit redaction", async () => {
    fake.setInstance(fakeSandboxReturning(`config.ts:1:TOKEN=${TOKEN}\n`))

    const tools = toolsetFor(sandboxTarget)
    const out = await tools.grep.execute!({ pattern: "TOKEN" }, {} as never)

    expect(out).not.toContain(TOKEN)
    expect(out).toContain("[REDACTED]")
  })

  it("includes the cross-cutting read_document tool", () => {
    const tools = toolsetFor(sandboxTarget)
    expect(tools.read_document).toBeDefined()
  })

  it("assembles the new grep and glob tools", () => {
    const tools = toolsetFor(sandboxTarget)
    expect(tools.grep).toBeDefined()
    expect(tools.glob).toBeDefined()
  })

  it("preserves submit_plan as a human-in-the-loop tool with no execute", () => {
    const tools = toolsetFor(sandboxTarget)
    expect(tools.submit_plan).toBeDefined()
    expect(tools.submit_plan.execute).toBeUndefined()
  })
})

describe("withRedactedOutput", () => {
  it("leaves a tool with no execute untouched", () => {
    const passthrough = { submit_plan: { description: "x", inputSchema: undefined } } as never
    const wrapped = withRedactedOutput(passthrough)
    expect(wrapped.submit_plan.execute).toBeUndefined()
  })
})
