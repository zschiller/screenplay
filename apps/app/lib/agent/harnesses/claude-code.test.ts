import { describe, expect, it } from "vitest"

import {
  claudeCodePrintModel,
  probeClaudeCodeAuth,
} from "@/lib/agent/harnesses/claude-code"
import type { HarnessProcessRunner } from "@/lib/agent/harnesses/types"

/**
 * Claude Code's per-descriptor auth probe (ADR 0015) reads the CLI's own stored
 * credential through an **injected process runner**, so a fake runner drives it
 * without a real keychain or credential file. Honest degradation: every
 * uncertainty — a spawn failure, an absent credential, an unparseable config —
 * resolves to *not authed* (offer sign-in), never a false "connected".
 */

/**
 * Route each credential probe to a canned reply, so one test can stage the
 * keychain / `.credentials.json` / `~/.claude.json` lookups independently. Any
 * unspecified probe defaults to a clean "absent" (exit 1, empty stdout); a
 * reply of `"enoent"` makes that spawn reject like a missing binary.
 */
function router(replies: {
  keychain?: { exitCode: number; stdout: string } | "enoent"
  credentialsFile?: { exitCode: number; stdout: string } | "enoent"
  claudeJson?: { exitCode: number; stdout: string } | "enoent"
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
    if (cmd === "security") return resolve(replies.keychain)
    if (cmd === "sh") {
      const script = args[1] ?? ""
      if (script.includes(".credentials.json")) {
        return resolve(replies.credentialsFile)
      }
      if (script.includes(".claude.json")) return resolve(replies.claudeJson)
    }
    throw new Error(`unexpected probe: ${cmd} ${args.join(" ")}`)
  }
}

describe("probeClaudeCodeAuth", () => {
  it("is authed when the macOS keychain holds the credential", async () => {
    const run = router({ keychain: { exitCode: 0, stdout: "secret-blob\n" } })
    expect(await probeClaudeCodeAuth(run)).toBe(true)
  })

  it("falls back to ~/.claude/.credentials.json when the keychain is empty", async () => {
    const run = router({
      keychain: { exitCode: 1, stdout: "" },
      credentialsFile: { exitCode: 0, stdout: '{"claudeAiOauth":{}}' },
    })
    expect(await probeClaudeCodeAuth(run)).toBe(true)
  })

  it("reads the ~/.claude.json oauthAccount block as a secondary signal", async () => {
    const run = router({
      claudeJson: {
        exitCode: 0,
        stdout: JSON.stringify({ oauthAccount: { emailAddress: "a@b.com" } }),
      },
    })
    expect(await probeClaudeCodeAuth(run)).toBe(true)
  })

  it("is not authed when no credential is present anywhere", async () => {
    // Every probe defaults to absent (exit 1, empty).
    expect(await probeClaudeCodeAuth(router({}))).toBe(false)
  })

  it("is not authed when the credential-store binary can't be spawned", async () => {
    const run = router({
      keychain: "enoent",
      credentialsFile: "enoent",
      claudeJson: "enoent",
    })
    expect(await probeClaudeCodeAuth(run)).toBe(false)
  })

  it("degrades an indeterminate probe (present-but-empty / unparseable) to not authed", async () => {
    const run = router({
      // Keychain item exists but yields nothing usable…
      keychain: { exitCode: 0, stdout: "  \n" },
      // …the credential file is missing…
      credentialsFile: { exitCode: 1, stdout: "" },
      // …and ~/.claude.json is present but not valid JSON.
      claudeJson: { exitCode: 0, stdout: "not json {{{" },
    })
    expect(await probeClaudeCodeAuth(run)).toBe(false)
  })

  it("ignores a ~/.claude.json with no oauthAccount block", async () => {
    const run = router({
      claudeJson: { exitCode: 0, stdout: JSON.stringify({ theme: "auto" }) },
    })
    expect(await probeClaudeCodeAuth(run)).toBe(false)
  })
})

/**
 * Claude Code's per-descriptor print-mode builder (Seam D, #674): a pure
 * function asserted against the expected non-interactive argv and its light
 * output parse. Prior art: the per-harness install-command / auth-command
 * descriptor tests.
 */
describe("claudeCodePrintModel", () => {
  it("builds the `claude -p <prompt>` argv with the prompt as a single arg", () => {
    expect(claudeCodePrintModel.buildArgv("please fix the login")).toEqual([
      "claude",
      "-p",
      "please fix the login",
    ])
  })

  it("passes the prompt verbatim — no shell interpolation of quotes/newlines", () => {
    const prompt = 'add a "dark mode" toggle\nand a setting'
    expect(claudeCodePrintModel.buildArgv(prompt)).toEqual([
      "claude",
      "-p",
      prompt,
    ])
  })

  it("parses stdout to the model's text, trimmed", () => {
    expect(claudeCodePrintModel.parseOutput("  fix-login\nFix Login\n")).toBe(
      "fix-login\nFix Login"
    )
  })

  it("returns null for empty / whitespace-only output", () => {
    expect(claudeCodePrintModel.parseOutput("")).toBeNull()
    expect(claudeCodePrintModel.parseOutput("   \n\t")).toBeNull()
  })
})
