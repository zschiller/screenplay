import { describe, expect, it } from "vitest"
import { acpChildEnv, resolveAcpLaunch } from "./acp-launch"

/**
 * The harness → ACP launch resolver is a pure key → argv lookup, the ACP
 * sibling of the terminal's `resolveLaunchArgv` (issue #414, spikes #405/#408).
 * Like that resolver it must map the known keys and fall through gracefully on
 * anything else, and it must strip the Claude-Code session env vars that would
 * otherwise make the Claude adapter refuse to launch.
 */
describe("resolveAcpLaunch", () => {
  it("maps the claude key to the claude-code-acp adapter spawn argv", () => {
    const launch = resolveAcpLaunch("claude", { cwd: "/work/tree", env: {} })
    expect(launch).toEqual({
      command: "npx",
      args: ["-y", "@zed-industries/claude-code-acp"],
      cwd: "/work/tree",
      env: {},
    })
  })

  it("maps the codex key to the codex-acp adapter spawn argv", () => {
    const launch = resolveAcpLaunch("codex", { cwd: "/work/tree", env: {} })
    expect(launch?.command).toBe("npx")
    expect(launch?.args).toEqual(["-y", "@zed-industries/codex-acp"])
  })

  it("uses the worktree as the child cwd", () => {
    const launch = resolveAcpLaunch("claude", {
      cwd: "/repos/x/wt-42",
      env: {},
    })
    expect(launch?.cwd).toBe("/repos/x/wt-42")
  })

  it("falls through to null on an unknown key", () => {
    expect(resolveAcpLaunch("nope", { cwd: "/w", env: {} })).toBeNull()
  })

  it("falls through to null for gemini (dropped — no ACP adapter successor)", () => {
    expect(resolveAcpLaunch("gemini", { cwd: "/w", env: {} })).toBeNull()
  })

  it("falls through to null for a terminal-only harness key", () => {
    // The terminal catalog key is `claude-code`; the ACP adapter key is `claude`.
    expect(resolveAcpLaunch("claude-code", { cwd: "/w", env: {} })).toBeNull()
    expect(
      resolveAcpLaunch("opencode-gateway", { cwd: "/w", env: {} })
    ).toBeNull()
  })

  it("falls through to null for an empty / nullish key", () => {
    expect(resolveAcpLaunch("", { cwd: "/w", env: {} })).toBeNull()
    expect(resolveAcpLaunch(null, { cwd: "/w", env: {} })).toBeNull()
    expect(resolveAcpLaunch(undefined, { cwd: "/w", env: {} })).toBeNull()
  })

  it("strips CLAUDECODE and nested CLAUDE_CODE_* vars but passes the rest through", () => {
    const launch = resolveAcpLaunch("claude", {
      cwd: "/w",
      env: {
        CLAUDECODE: "1",
        CLAUDE_CODE_ENTRYPOINT: "cli",
        CLAUDE_CODE_SSE_PORT: "1234",
        PATH: "/usr/bin",
        HOME: "/home/dev",
        ANTHROPIC_API_KEY: undefined,
      },
    })
    expect(launch?.env).toEqual({ PATH: "/usr/bin", HOME: "/home/dev" })
  })
})

describe("acpChildEnv", () => {
  it("drops undefined values and the Claude-Code session vars", () => {
    expect(
      acpChildEnv({
        CLAUDECODE: "1",
        CLAUDE_CODE_FOO: "bar",
        KEEP: "yes",
        GONE: undefined,
      })
    ).toEqual({ KEEP: "yes" })
  })

  it("does not mutate its input", () => {
    const input = { CLAUDECODE: "1", KEEP: "yes" }
    acpChildEnv(input)
    expect(input).toEqual({ CLAUDECODE: "1", KEEP: "yes" })
  })
})
