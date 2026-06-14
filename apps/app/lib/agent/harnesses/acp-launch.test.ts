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
  it("maps the claude-code catalog key to the claude-code-acp adapter spawn argv", () => {
    const launch = resolveAcpLaunch("claude-code", {
      cwd: "/work/tree",
      env: {},
    })
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

  // Codex advertises no `availableModels` (spike #523), so a per-chat model
  // choice rides the spawn argv as `--model <id>` rather than ACP's in-session
  // `setSessionModel`.
  it("appends codex's `--model <id>` when a model is chosen", () => {
    const launch = resolveAcpLaunch("codex", {
      cwd: "/work/tree",
      env: {},
      modelId: "gpt-5.5",
    })
    expect(launch?.args).toEqual([
      "-y",
      "@zed-industries/codex-acp",
      "--model",
      "gpt-5.5",
    ])
  })

  it("leaves codex's argv unchanged when no model is chosen (Harness default)", () => {
    const launch = resolveAcpLaunch("codex", { cwd: "/work/tree", env: {} })
    expect(launch?.args).toEqual(["-y", "@zed-industries/codex-acp"])
  })

  // claude-code is ACP-native (no `modelArgs`): a chosen model is applied
  // in-session via `setSessionModel`, never on the spawn argv (spike #523).
  it("does not fold a model into claude-code's argv (it is ACP-native)", () => {
    const launch = resolveAcpLaunch("claude-code", {
      cwd: "/work/tree",
      env: {},
      modelId: "sonnet",
    })
    expect(launch?.args).toEqual(["-y", "@zed-industries/claude-code-acp"])
  })

  it("uses the worktree as the child cwd", () => {
    const launch = resolveAcpLaunch("claude-code", {
      cwd: "/repos/x/wt-42",
      env: {},
    })
    expect(launch?.cwd).toBe("/repos/x/wt-42")
  })

  it("falls through to null on an unknown key", () => {
    expect(resolveAcpLaunch("nope", { cwd: "/w", env: {} })).toBeNull()
  })

  it("falls through to null for the retired `claude` adapter key (one key per CLI now)", () => {
    // The adapter map is gone: `claude-code` is the single catalog key, so the
    // old standalone `claude` adapter key no longer resolves.
    expect(resolveAcpLaunch("claude", { cwd: "/w", env: {} })).toBeNull()
  })

  it("falls through to null for gemini (dropped — no ACP adapter successor)", () => {
    expect(resolveAcpLaunch("gemini", { cwd: "/w", env: {} })).toBeNull()
  })

  it("falls through to null for a terminal-only harness (no acpAdapter on its descriptor)", () => {
    // Both opencode slots are terminal-only — their descriptors carry no adapter.
    expect(
      resolveAcpLaunch("opencode-gateway", { cwd: "/w", env: {} })
    ).toBeNull()
    expect(
      resolveAcpLaunch("opencode-compat", { cwd: "/w", env: {} })
    ).toBeNull()
  })

  it("falls through to null for an empty / nullish key", () => {
    expect(resolveAcpLaunch("", { cwd: "/w", env: {} })).toBeNull()
    expect(resolveAcpLaunch(null, { cwd: "/w", env: {} })).toBeNull()
    expect(resolveAcpLaunch(undefined, { cwd: "/w", env: {} })).toBeNull()
  })

  it("strips CLAUDECODE and nested CLAUDE_CODE_* vars but passes the rest through", () => {
    const launch = resolveAcpLaunch("claude-code", {
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
