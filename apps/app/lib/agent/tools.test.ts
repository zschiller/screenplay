import { beforeEach, describe, expect, it, vi } from "vitest"
import type { z } from "zod"

import type {
  SandboxCommandResult,
  SandboxFile,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// Sandbox tools resolve the live instance through the provider seam. A fake
// provider — scripted, no real VM — stands in for Vercel Sandbox so each tool's
// inlined `execute` runs against the real code path. `vi.hoisted` lets the mock
// factory close over a mutable holder we can rescript per test.
const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async () => {
      throw new Error("create not used by the tools")
    }),
  }
  return {
    provider,
    setInstance: (i: SandboxInstance) => {
      instance = i
    },
  }
})

// `usesHostGitAuth` is the build-time backend switch (worktree → host-native git
// auth); a mutable holder lets a test flip it to the local path.
const backend = vi.hoisted(() => ({ hostGitAuth: false }))
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: fake.provider,
  get usesHostGitAuth() {
    return backend.hostGitAuth
  },
}))
// The git-env helper reaches into the auth stack for a per-user token. Tools
// under test don't care about its value; stub it so the import graph stays out
// of the DB/runtime-env chain.
vi.mock("@/lib/auth-helpers", () => ({
  getGitHubTokenForUser: vi.fn(async () => null),
  getGitIdentityForUser: vi.fn(async () => null),
}))
// `create_pr` pulls in github-pr, which transitively imports yjs/server and
// reads LIVEBLOCKS_SECRET_KEY at import. Stub it so the tools' import graph
// stays unit-testable under plain Node.
vi.mock("@/lib/github-pr", () => ({
  createGitHubPr: vi.fn(async () => ({
    url: "https://example/pr/1",
    number: 1,
  })),
}))

import {
  getGitHubTokenForUser,
  getGitIdentityForUser,
} from "@/lib/auth-helpers"

import { buildSandboxTools, type ToolContext } from "@/lib/agent/tools"

const ctx: ToolContext = {
  sandboxName: "sandbox-a",
  roomId: "room-1",
  userId: "user-1",
}

/**
 * A fake {@link SandboxInstance} exposing only the surface the sandbox tools
 * touch. Reads are served from `files`; writes mutate it so a write-then-read
 * round-trips. `commands` scripts `runCommand`. Anything unimplemented throws so
 * an accidental dependency is loud, not silent.
 */
function fakeSandbox(opts: {
  files?: Record<string, string>
  command?: (
    cmd: string,
    args: string[]
  ) => { exitCode: number; stdout?: string; stderr?: string }
}): SandboxInstance {
  const files: Record<string, string> = { ...opts.files }
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
    const scripted = opts.command?.(cmd, args) ?? { exitCode: 0 }
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
    writeFiles: async (toWrite: SandboxFile[]) => {
      for (const f of toWrite) files[f.path] = f.content.toString()
    },
    readFileToBuffer: async ({ path }: { path: string }) =>
      path in files ? Buffer.from(files[path], "utf-8") : null,
    delete: async () => {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  backend.hostGitAuth = false
  // clearAllMocks wipes call history but keeps implementations; restore the
  // null defaults so a test that scripts an identity doesn't leak into the next.
  vi.mocked(getGitHubTokenForUser).mockResolvedValue(null)
  vi.mocked(getGitIdentityForUser).mockResolvedValue(null)
})

describe("read_file", () => {
  it("returns the file's contents with cat -n-style line numbers", async () => {
    fake.setInstance(
      fakeSandbox({ files: { "src/App.tsx": "line one\nline two" } })
    )

    const out = await buildSandboxTools(ctx).read_file.execute!(
      { path: "src/App.tsx" },
      {} as never
    )

    expect(out).toBe("     1\tline one\n     2\tline two")
  })

  it("windows to offset/limit and notes there is more to read", async () => {
    fake.setInstance(fakeSandbox({ files: { "a.ts": "l1\nl2\nl3\nl4" } }))

    const out = await buildSandboxTools(ctx).read_file.execute!(
      { path: "a.ts", offset: 2, limit: 1 },
      {} as never
    )

    expect(out).toContain("     2\tl2")
    expect(out).not.toContain("\tl1")
    expect(out).not.toContain("\tl3")
    expect(out).toContain("4 lines")
  })

  it("reports a missing file rather than throwing", async () => {
    fake.setInstance(fakeSandbox({ files: {} }))

    const out = await buildSandboxTools(ctx).read_file.execute!(
      { path: "nope.ts" },
      {} as never
    )

    expect(out).toBe("File not found: nope.ts")
  })
})

describe("write_file", () => {
  it("writes the content and round-trips through read_file", async () => {
    fake.setInstance(fakeSandbox({ files: {} }))
    const tools = buildSandboxTools(ctx)

    const written = await tools.write_file.execute!(
      { path: "a.txt", content: "hello" },
      {} as never
    )
    expect(written).toBe("Written 5 bytes to a.txt")

    const back = await tools.read_file.execute!({ path: "a.txt" }, {} as never)
    expect(back).toContain("\thello")
  })
})

describe("edit_file", () => {
  it("replaces an exact match", async () => {
    fake.setInstance(fakeSandbox({ files: { "a.ts": "const x = 1" } }))
    const tools = buildSandboxTools(ctx)

    await tools.edit_file.execute!(
      { path: "a.ts", old_string: "1", new_string: "2" },
      {} as never
    )

    const back = await tools.read_file.execute!({ path: "a.ts" }, {} as never)
    expect(back).toContain("\tconst x = 2")
  })

  it("reports when old_string is absent instead of editing", async () => {
    fake.setInstance(fakeSandbox({ files: { "a.ts": "const x = 1" } }))

    const out = await buildSandboxTools(ctx).edit_file.execute!(
      { path: "a.ts", old_string: "zzz", new_string: "2" },
      {} as never
    )

    expect(out).toContain("old_string not found")
  })

  it("refuses an ambiguous edit, reports the count, and leaves the file unchanged", async () => {
    fake.setInstance(fakeSandbox({ files: { "a.ts": "x\nx\nx" } }))
    const tools = buildSandboxTools(ctx)

    const out = await tools.edit_file.execute!(
      { path: "a.ts", old_string: "x", new_string: "y" },
      {} as never
    )

    expect(out).toContain("3")
    expect(out).toMatch(/ambiguous|matches/i)

    const back = await tools.read_file.execute!({ path: "a.ts" }, {} as never)
    expect(back).toContain("\tx")
    expect(back).not.toContain("\ty")
  })

  it("replaces every occurrence under replace_all and reports the count", async () => {
    fake.setInstance(fakeSandbox({ files: { "a.ts": "x\nx\nx" } }))
    const tools = buildSandboxTools(ctx)

    const out = await tools.edit_file.execute!(
      { path: "a.ts", old_string: "x", new_string: "y", replace_all: true },
      {} as never
    )

    expect(out).toContain("3")

    const back = await tools.read_file.execute!({ path: "a.ts" }, {} as never)
    expect(back).toContain("\ty")
    expect(back).not.toContain("\tx")
  })
})

describe("run_command", () => {
  it("frames stdout, stderr, and the exit code", async () => {
    fake.setInstance(
      fakeSandbox({
        command: () => ({ exitCode: 2, stdout: "out", stderr: "err" }),
      })
    )

    const out = await buildSandboxTools(ctx).run_command.execute!(
      { command: "npm test" },
      {} as never
    )

    expect(out).toContain("stdout:\nout")
    expect(out).toContain("stderr:\nerr")
    expect(out).toContain("exit code: 2")
  })

  it("brokers a per-command git token on the hosted backend", async () => {
    fake.setInstance(fakeSandbox({ command: () => ({ exitCode: 0 }) }))

    await buildSandboxTools(ctx).run_command.execute!(
      { command: "git push" },
      {} as never
    )

    // Hosted path looks up the acting user's token to inject SCREENPLAY_GH_TOKEN.
    expect(getGitHubTokenForUser).toHaveBeenCalledWith("user-1")
  })

  it("brokers the acting user's commit identity per command", async () => {
    // Authorship rides the same per-command env as the token: the acting user's
    // real name + email as GIT_AUTHOR_*/GIT_COMMITTER_*, so commits in a shared
    // sandbox attribute to whoever drove them — never a fabricated address.
    vi.mocked(getGitIdentityForUser).mockResolvedValue({
      name: "Octo Cat",
      email: "octo@users.noreply.github.com",
    })
    let env: Record<string, string> | undefined
    const instance = fakeSandbox({ command: () => ({ exitCode: 0 }) })
    const passthrough = instance.runCommand
    instance.runCommand = ((cmdOrOpts: unknown, args?: string[]) => {
      if (cmdOrOpts && typeof cmdOrOpts === "object") {
        env = (cmdOrOpts as { env?: Record<string, string> }).env
      }
      return (passthrough as (c: unknown, a?: string[]) => unknown)(
        cmdOrOpts,
        args
      )
    }) as SandboxInstance["runCommand"]
    fake.setInstance(instance)

    await buildSandboxTools(ctx).run_command.execute!(
      { command: "git commit -m wip" },
      {} as never
    )

    expect(getGitIdentityForUser).toHaveBeenCalledWith("user-1")
    expect(env).toMatchObject({
      GIT_AUTHOR_NAME: "Octo Cat",
      GIT_AUTHOR_EMAIL: "octo@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Octo Cat",
      GIT_COMMITTER_EMAIL: "octo@users.noreply.github.com",
    })
  })

  it("under host-native git auth, doesn't broker a per-command token", async () => {
    backend.hostGitAuth = true
    fake.setInstance(fakeSandbox({ command: () => ({ exitCode: 0 }) }))

    await buildSandboxTools(ctx).run_command.execute!(
      { command: "git push" },
      {} as never
    )

    // Local worktree path rides host credentials — no token lookup, no injection.
    expect(getGitHubTokenForUser).not.toHaveBeenCalled()
  })

  it("leaves a token in its output untouched — redaction is the assembly point's job", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    fake.setInstance(
      fakeSandbox({
        command: () => ({ exitCode: 0, stdout: `using ${token}` }),
      })
    )

    const out = await buildSandboxTools(ctx).run_command.execute!(
      { command: "git remote -v" },
      {} as never
    )

    expect(out).toContain(token)
  })
})

describe("list_files", () => {
  it("returns the find output", async () => {
    fake.setInstance(
      fakeSandbox({
        command: () => ({ exitCode: 0, stdout: "./a.ts\n./b.ts" }),
      })
    )

    const out = await buildSandboxTools(ctx).list_files.execute!(
      {},
      {} as never
    )

    expect(out).toBe("./a.ts\n./b.ts")
  })
})

describe("grep", () => {
  it("returns ripgrep matches", async () => {
    fake.setInstance(
      fakeSandbox({
        command: (cmd) =>
          cmd === "rg"
            ? { exitCode: 0, stdout: "a.ts:1:useState(0)" }
            : { exitCode: 1 },
      })
    )

    const out = await buildSandboxTools(ctx).grep.execute!(
      { pattern: "useState" },
      {} as never
    )

    expect(out).toContain("a.ts:1:useState(0)")
  })

  it("falls back to grep when ripgrep is not installed (exit 127)", async () => {
    fake.setInstance(
      fakeSandbox({
        command: (cmd) => {
          if (cmd === "rg")
            return { exitCode: 127, stderr: "rg: command not found" }
          if (cmd === "grep")
            return { exitCode: 0, stdout: "b.ts:2:useState(1)" }
          return { exitCode: 1 }
        },
      })
    )

    const out = await buildSandboxTools(ctx).grep.execute!(
      { pattern: "useState" },
      {} as never
    )

    expect(out).toContain("b.ts:2:useState(1)")
  })

  it("reports no matches rather than returning an empty string", async () => {
    fake.setInstance(
      fakeSandbox({ command: () => ({ exitCode: 1, stdout: "" }) })
    )

    const out = await buildSandboxTools(ctx).grep.execute!(
      { pattern: "nope" },
      {} as never
    )

    expect(out).toMatch(/no matches/i)
  })
})

describe("glob", () => {
  it("returns the matching file paths from find", async () => {
    fake.setInstance(
      fakeSandbox({
        command: (cmd) =>
          cmd === "find"
            ? { exitCode: 0, stdout: "./a.tsx\n./b.tsx" }
            : { exitCode: 1 },
      })
    )

    const out = await buildSandboxTools(ctx).glob.execute!(
      { pattern: "**/*.tsx" },
      {} as never
    )

    expect(out).toBe("./a.tsx\n./b.tsx")
  })
})

describe("read_skill", () => {
  it("lists available skills when the name is unknown", async () => {
    const out = await buildSandboxTools(ctx).read_skill.execute!(
      { name: "does-not-exist" },
      {} as never
    )

    expect(out).toContain('Unknown skill: "does-not-exist"')
  })

  it("resolves a Repo Skill from the sandbox (sandbox-first)", async () => {
    fake.setInstance(
      fakeSandbox({
        files: {
          ".claude/skills/deploy/SKILL.md":
            "---\nname: deploy\ndescription: Deploy it.\n---\nDEPLOY BODY",
        },
      })
    )

    const out = await buildSandboxTools(ctx).read_skill.execute!(
      { name: "deploy" },
      {} as never
    )

    expect(out).toContain("DEPLOY BODY")
  })

  it("falls back to an App Skill when no Repo Skill matches", async () => {
    // Sandbox has no `.claude/skills/screenplay-add-knob` — resolution falls
    // through to the bundled App Skill of the same name.
    fake.setInstance(fakeSandbox({ files: {} }))

    const out = await buildSandboxTools(ctx).read_skill.execute!(
      { name: "screenplay-add-knob" },
      {} as never
    )

    expect(out).toContain("name: screenplay-add-knob")
  })

  it("lists the merged App ∪ Repo set when the name is unknown", async () => {
    fake.setInstance(
      fakeSandbox({
        files: {
          ".claude/skills/deploy/SKILL.md":
            "---\nname: deploy\ndescription: Repo deploy.\n---\nbody",
        },
        command: (cmd) =>
          cmd === "ls" ? { exitCode: 0, stdout: "deploy" } : { exitCode: 1 },
      })
    )

    const out = await buildSandboxTools(ctx).read_skill.execute!(
      { name: "nope" },
      {} as never
    )

    expect(out).toContain('Unknown skill: "nope"')
    // Repo Skill from the sandbox …
    expect(out).toContain("- deploy: Repo deploy.")
    // … merged with the bundled App Skills.
    expect(out).toContain("screenplay-add-knob")
  })
})

describe("input validation", () => {
  // The AI SDK types `inputSchema` as an opaque `FlexibleSchema`; at runtime it
  // is exactly the zod schema we handed `tool()`, so we narrow to assert the
  // schema-level rejection the SDK performs before `execute` ever runs.
  const schemaOf = (tool: { inputSchema: unknown }) =>
    tool.inputSchema as z.ZodType<{ path: string }>

  it("rejects a read_file call missing its required path", () => {
    const result = schemaOf(buildSandboxTools(ctx).read_file).safeParse({})

    expect(result.success).toBe(false)
  })

  it("accepts a well-formed read_file argument", () => {
    const result = schemaOf(buildSandboxTools(ctx).read_file).safeParse({
      path: "src/App.tsx",
    })

    expect(result.success).toBe(true)
  })
})
