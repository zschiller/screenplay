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
vi.mock("@/lib/auth-helpers", () => ({
  getGitHubTokenForUser: vi.fn(async () => null),
}))
vi.mock("@/lib/github-pr", () => ({ createGitHubPr: vi.fn() }))

import { toolsetOn, withRedactedOutput } from "@/lib/agent/toolset"
import { workspaceChatTarget } from "@/lib/agent/workspace-chat-target"
import { secretPatterns } from "@/lib/agent/redact"

// The turn's Room: the tools reach the room doc only through it.
const room = {
  roomId: "room-1",
  readDoc: vi.fn(async () => null),
  mutateDoc: vi.fn(async () => {}),
} as never
/** A Workspace chat's toolset on the in-process engine. */
const workspaceToolset = () =>
  toolsetOn(
    workspaceChatTarget.tools(room, {
      sandboxName: "sandbox-a",
      chatId: "chat-1",
      userId: "user-1",
    }),
    "in-process"
  )

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
    homeDir: "/home/vercel-sandbox",
    domain: notUsed("domain") as never,
    internalUrl: notUsed("internalUrl") as never,
    expose: notUsed("expose") as never,
    hostPort: notUsed("hostPort") as never,
    runCommand: (async () => cmd) as SandboxInstance["runCommand"],
    writeFiles: async () => {},
    readFileToBuffer: async () => Buffer.from(content, "utf-8"),
    delete: async () => {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("toolsetOn (a Workspace chat, in process)", () => {
  it("redacts a GitHub token from read_file output — closing the leak structurally", async () => {
    fake.setInstance(fakeSandboxReturning(`TOKEN=${TOKEN}\n`))

    const tools = workspaceToolset()
    const out = await tools.read_file.execute!({ path: ".env" }, {} as never)

    expect(out).not.toContain(TOKEN)
    expect(out).toContain("[REDACTED]")
  })

  it("redacts a GitHub token from grep output — new tools inherit redaction", async () => {
    fake.setInstance(fakeSandboxReturning(`config.ts:1:TOKEN=${TOKEN}\n`))

    const tools = workspaceToolset()
    const out = await tools.grep.execute!({ pattern: "TOKEN" }, {} as never)

    expect(out).not.toContain(TOKEN)
    expect(out).toContain("[REDACTED]")
  })

  it("includes the cross-cutting read_document tool", () => {
    const tools = workspaceToolset()
    expect(tools.read_document).toBeDefined()
  })

  it("gives every chat the ask_question tool (#1312)", async () => {
    const tools = workspaceToolset()
    const ask = tools.ask_question.execute!
    expect(
      await ask(
        {
          question: "Which layout?",
          options: [{ label: "A" }, { label: "B" }],
        },
        {} as never
      )
    ).toMatch(/^Asked\. End your turn/)
    expect(
      await ask({ question: "Which?", options: [{ label: "A" }] }, {} as never)
    ).toMatch(/^Not asked/)
  })

  it("reads other Workspaces' code, and has no tool that writes to them (#1315)", () => {
    const tools = workspaceToolset()
    expect(tools.read_code_file).toBeDefined()
    expect(tools.search_code).toBeDefined()
    expect(tools.find_code_files).toBeDefined()
    // Every write tool acts on the chat's own sandbox and takes no Workspace.
    for (const name of ["write_file", "edit_file", "run_command"]) {
      const schema = tools[name]!.inputSchema as { shape?: object }
      expect(Object.keys(schema.shape ?? {})).not.toContain("workspaceId")
    }
  })

  it("assembles the new grep and glob tools", () => {
    const tools = workspaceToolset()
    expect(tools.grep).toBeDefined()
    expect(tools.glob).toBeDefined()
  })

  it("gives a Workspace chat the Mockup tools (#1309)", () => {
    const tools = workspaceToolset()
    expect(tools.create_mockup).toBeDefined()
    expect(tools.update_mockup).toBeDefined()
  })

  it("gives a chat none of the Coordinator’s page tools (#1842)", () => {
    const tools = workspaceToolset() as Record<string, unknown>
    for (const name of [
      "create_page",
      "rename_page",
      "delete_page",
      "move_to_page",
    ]) {
      expect(tools[name]).toBeUndefined()
    }
  })

  it("preserves submit_plan as a human-in-the-loop tool with no execute", () => {
    const tools = workspaceToolset()
    expect(tools.submit_plan).toBeDefined()
    expect(tools.submit_plan.execute).toBeUndefined()
  })
})

describe("withRedactedOutput", () => {
  it("leaves a tool with no execute untouched", () => {
    const passthrough = {
      submit_plan: { description: "x", inputSchema: undefined },
    } as never
    const wrapped = withRedactedOutput(passthrough)
    expect(wrapped.submit_plan.execute).toBeUndefined()
  })

  it("scrubs the Workspace's env var values before the model sees them (#1416)", async () => {
    const secret = "sk_live_0123456789abcdef"
    const tools = {
      run_command: {
        description: "x",
        execute: async () => `STRIPE_KEY=${secret}\nPORT=3000`,
      },
      read_json: {
        description: "x",
        execute: async () => ({ env: { STRIPE_KEY: secret }, exitCode: 0 }),
      },
    } as never
    const wrapped = withRedactedOutput(tools, secretPatterns([secret]))
    const run = (name: string) =>
      (wrapped[name]!.execute as (i: unknown, o: unknown) => Promise<unknown>)(
        {},
        {}
      )

    expect(await run("run_command")).toBe("STRIPE_KEY=[REDACTED]\nPORT=3000")
    expect(await run("read_json")).toEqual({
      env: { STRIPE_KEY: "[REDACTED]" },
      exitCode: 0,
    })
  })
})
