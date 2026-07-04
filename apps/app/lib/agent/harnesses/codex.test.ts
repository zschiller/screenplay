import { describe, expect, it } from "vitest"

import type { SandboxInstance } from "@/lib/sandbox/types"
import type { HarnessProcessRunner } from "@/lib/agent/harnesses/types"
import { harnessLaunchArgv } from "@/lib/agent/harnesses"
import { codexConfigToml } from "./codex"
import { codexHarness, codexPrintModel, probeCodexAuth } from "./codex"

/** A `runCommand` invocation captured by the fake sandbox below. */
type RecordedCall = {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

/**
 * Minimal fake {@link SandboxInstance} that records every `runCommand` (object
 * form) so a test can assert what the seed wrote and where. Everything the seed
 * doesn't touch throws, so an accidental dependency is loud. `homeDir` differs
 * from any backend default to prove the seed follows the provider-supplied path.
 */
function fakeSandbox(
  calls: RecordedCall[],
  homeDir = "/home/agent"
): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  return {
    name: "fake-sandbox",
    worktreePath: "/workspace/repo",
    homeDir,
    domain: (port: number) => `https://fake-${port}.example.com`,
    hostPort: (port: number) => port,
    runCommand: ((cmdOrOpts: unknown) => {
      const opts = cmdOrOpts as {
        cmd: string
        args?: string[]
        env?: Record<string, string>
      }
      calls.push({ cmd: opts.cmd, args: opts.args ?? [], env: opts.env })
      return Promise.resolve({
        exitCode: 0,
        stdout: async () => "",
        stderr: async () => "",
        logs: notUsed("logs") as never,
        kill: async () => {},
      })
    }) as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
}

describe("codexConfigToml", () => {
  const toml = codexConfigToml()

  it("selects a custom model_provider whose base_url targets the brokered host", () => {
    expect(toml).toContain(`model_provider = "screenplay-openai"`)
    expect(toml).toContain("[model_providers.screenplay-openai]")
    expect(toml).toContain(`base_url = "https://api.openai.com/v1"`)
  })

  it("points env_key at the dummy-valued gate var (the firewall injects the real key)", () => {
    // OPENAI_API_KEY boots as the dummy "brokered" placeholder; Codex sends it
    // as the bearer and the egress firewall overwrites it with the real key.
    expect(toml).toContain(`env_key = "OPENAI_API_KEY"`)
  })

  it("presets the approval policy so the CLI boots past first-run gates", () => {
    expect(toml).toContain(`approval_policy = "never"`)
  })
})

describe("seedCodex", () => {
  it("writes config.toml and AGENTS.md under the provider-supplied ~/.codex", async () => {
    const calls: RecordedCall[] = []
    await codexHarness.seed(fakeSandbox(calls))

    const configCall = calls.find((c) => c.env?.CODEX_CONFIG)
    expect(configCall).toBeDefined()
    expect(configCall!.env!.CODEX_CONFIG).toBe(codexConfigToml())
    expect(configCall!.args.at(-1)).toContain(
      '"/home/agent/.codex/config.toml"'
    )

    const agentsCall = calls.find((c) => c.env?.CODEX_AGENTS_MD)
    expect(agentsCall).toBeDefined()
    expect(agentsCall!.args.at(-1)).toContain('"/home/agent/.codex/AGENTS.md"')
  })

  it("seeds the always-commit-and-push rule into the home-level AGENTS.md", async () => {
    const calls: RecordedCall[] = []
    await codexHarness.seed(fakeSandbox(calls))

    const agentsMd = calls.find((c) => c.env?.CODEX_AGENTS_MD)!.env!
      .CODEX_AGENTS_MD!
    expect(agentsMd).toContain("always commit and push")
    expect(agentsMd).toContain("git push")

    // The rule lands ONLY in the harness's home agents file, never the repo
    // root AGENTS.md — git history stays clean.
    const wrote = calls.map((c) => c.args.join(" ")).join("\n")
    expect(wrote).toContain("/home/agent/.codex/AGENTS.md")
    expect(wrote).not.toContain("/workspace/repo/AGENTS.md")
  })
})

/**
 * Route each credential probe to a canned reply, so one test can stage the
 * `~/.codex/auth.json` cat and the `CODEX_API_KEY` read independently. Any
 * unspecified probe defaults to a clean "absent" (exit 1, empty stdout); a reply
 * of `"enoent"` makes that spawn reject like a missing binary.
 */
function router(replies: {
  authJson?: { exitCode: number; stdout: string } | "enoent"
  apiKey?: { exitCode: number; stdout: string } | "enoent"
}): HarnessProcessRunner {
  const absent = { exitCode: 1, stdout: "" }
  const resolve = (
    reply: { exitCode: number; stdout: string } | "enoent" | undefined
  ) => {
    if (reply === "enoent") {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
    }
    return reply ?? absent
  }
  return async (cmd, args) => {
    if (cmd === "sh") {
      const script = args[1] ?? ""
      if (script.includes(".codex/auth.json")) return resolve(replies.authJson)
      if (script.includes("CODEX_API_KEY")) return resolve(replies.apiKey)
    }
    throw new Error(`unexpected probe: ${cmd} ${args.join(" ")}`)
  }
}

describe("probeCodexAuth", () => {
  it("is authed when ~/.codex/auth.json holds a credential", async () => {
    const run = router({
      authJson: { exitCode: 0, stdout: '{"OPENAI_API_KEY":"sk-..."}\n' },
    })
    expect(await probeCodexAuth(run)).toBe(true)
  })

  it("falls back to CODEX_API_KEY when auth.json is absent", async () => {
    const run = router({
      authJson: { exitCode: 1, stdout: "" },
      apiKey: { exitCode: 0, stdout: "sk-live-key" },
    })
    expect(await probeCodexAuth(run)).toBe(true)
  })

  it("is not authed when neither auth.json nor CODEX_API_KEY is present", async () => {
    // Both probes default to absent (auth.json missing, CODEX_API_KEY unset →
    // printf emits an empty string).
    expect(await probeCodexAuth(router({}))).toBe(false)
  })

  it("is not authed when the probe binary can't be spawned", async () => {
    const run = router({ authJson: "enoent", apiKey: "enoent" })
    expect(await probeCodexAuth(run)).toBe(false)
  })

  it("degrades an indeterminate probe (present-but-empty) to not authed", async () => {
    const run = router({
      // auth.json exists but is empty / whitespace…
      authJson: { exitCode: 0, stdout: "  \n" },
      // …and CODEX_API_KEY is set to whitespace only.
      apiKey: { exitCode: 0, stdout: "   " },
    })
    expect(await probeCodexAuth(run)).toBe(false)
  })
})

describe("codexHarness setup descriptor", () => {
  it("carries the three setup fields the spine reads", () => {
    // The row rides the already-built surface entirely off the descriptor.
    expect(codexHarness.probeAuth).toBe(probeCodexAuth)
    expect(typeof codexHarness.buildInstallCommand).toBe("function")
    expect(codexHarness.authCommand).toEqual(["codex", "login"])
  })
})

/**
 * Codex's per-descriptor print-mode builder (Seam D, #674/#679): a pure function
 * asserted against the expected non-interactive argv and its light output parse.
 * Codex's headless form is `codex exec "<prompt>"` — distinct from Claude Code's
 * `claude -p "<prompt>"`, which is exactly why print-argv is a per-harness field.
 * By default `codex exec` writes only the final message to stdout (activity goes
 * to stderr), so the parse is a trim, mirroring `claudeCodePrintModel`.
 */
describe("codexPrintModel", () => {
  it("builds the `codex exec <prompt>` argv with the prompt as a single arg", () => {
    expect(codexPrintModel.buildArgv("please fix the login")).toEqual([
      "codex",
      "exec",
      "please fix the login",
    ])
  })

  it("passes the prompt verbatim — no shell interpolation of quotes/newlines", () => {
    const prompt = 'add a "dark mode" toggle\nand a setting'
    expect(codexPrintModel.buildArgv(prompt)).toEqual(["codex", "exec", prompt])
  })

  it("parses stdout to the model's text, trimmed", () => {
    expect(codexPrintModel.parseOutput("  fix-login\nFix Login\n")).toBe(
      "fix-login\nFix Login"
    )
  })

  it("returns null for empty / whitespace-only output", () => {
    expect(codexPrintModel.parseOutput("")).toBeNull()
    expect(codexPrintModel.parseOutput("   \n\t")).toBeNull()
  })

  it("is wired onto the descriptor so `runHostModel` can reach it", () => {
    // Codex is chat-capable (non-null acpAdapter), so it participates in naming.
    expect(codexHarness.acpAdapter).not.toBeNull()
    expect(codexHarness.printModel).toBe(codexPrintModel)
  })
})

describe("harnessLaunchArgv", () => {
  it("returns codex's launch argv", () => {
    expect(harnessLaunchArgv("codex")).toEqual(["codex"])
  })

  it("returns claude-code's launch argv", () => {
    expect(harnessLaunchArgv("claude-code")).toEqual(["claude"])
  })

  it("returns null for an unknown harness key", () => {
    expect(harnessLaunchArgv("nope")).toBeNull()
  })
})
