import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import {
  BROKERED_VALUE,
  commitAndPushRuleMarkdown,
  type Harness,
  type HarnessPrintModel,
  type HarnessProcessRunner,
  type HostFacts,
} from "./types"
import { probeOk } from "./process-runner"

/** The npm package the `npm install -g` path installs (the `claude` binary). */
export const CLAUDE_CODE_INSTALL_PACKAGE = "@anthropic-ai/claude-code"

/**
 * Claude Code's official no-`npm` installer. Landing a `claude` binary in
 * `~/.local/bin` — already on the sidecar's augmented `PATH`
 * (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same session and
 * every later one — with no `sudo`, the same deterministic-path move the `gh`
 * binary fallback uses.
 */
export const CLAUDE_CODE_INSTALL_SCRIPT_URL = "https://claude.ai/install.sh"

/**
 * Claude Code's {@link Harness.buildInstallCommand} (ADR 0015): the pure mapping
 * from host facts → the install command run in the inline setup terminal:
 *
 * - **`npm` present** → `npm install -g @anthropic-ai/claude-code`, the global
 *   install that exposes `claude` on `PATH`.
 * - **No `npm`** → Claude Code's own `curl … | bash` installer, so a host with
 *   no `node`/`npm` never dead-ends (ADR 0015: the vendor installer is the
 *   npm-free path). It drops the binary in `~/.local/bin`, no `sudo`.
 *
 * Only `npmPresent` is consulted today; the wider {@link HostFacts} is taken so
 * the signature matches the descriptor's `buildInstallCommand` and a later
 * arch-specific path can read `arch` without a shape change.
 */
function buildClaudeCodeInstallCommand(facts: HostFacts): string {
  if (facts.npmPresent) return `npm install -g ${CLAUDE_CODE_INSTALL_PACKAGE}`
  return `curl -fsSL ${CLAUDE_CODE_INSTALL_SCRIPT_URL} | bash`
}

/**
 * The macOS login-keychain item Claude Code stores its OAuth credential under.
 * `security find-generic-password -s <service> -w` prints the secret and exits 0
 * when the item exists, so its presence is the strongest "signed in" signal.
 */
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials"

/**
 * Whether a stored Claude credential exists on the desktop host — Claude Code's
 * per-descriptor {@link Harness.probeAuth} (ADR 0015). Checked in confidence
 * order through the injected process runner (so a fake runner drives it in
 * tests), short-circuiting on the first hit:
 *
 *  1. the macOS login-keychain item (`security find-generic-password`);
 *  2. the `~/.claude/.credentials.json` fallback (the non-keychain store);
 *  3. the `~/.claude.json` `oauthAccount` block, a secondary signal.
 *
 * Any indeterminate result degrades to *not authed* (see {@link probeOk}); the
 * whole probe resolves `true` only when one location positively holds a
 * credential.
 */
export async function probeClaudeCodeAuth(
  run: HarnessProcessRunner
): Promise<boolean> {
  const nonEmpty = (r: { stdout: string }) => r.stdout.trim() !== ""

  // 1. macOS login keychain — the store the CLI prefers on a Mac.
  if (
    await probeOk(
      run,
      "security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      nonEmpty
    )
  ) {
    return true
  }

  // 2. The plaintext credential file fallback (`$HOME` expanded by the shell, so
  //    the probe needs no home-dir lookup of its own).
  if (
    await probeOk(
      run,
      "sh",
      ["-c", 'cat "$HOME/.claude/.credentials.json"'],
      nonEmpty
    )
  ) {
    return true
  }

  // 3. The `~/.claude.json` `oauthAccount` block — a weaker signal (it can linger
  //    after a logout), so it's last and requires the block to actually parse.
  return probeOk(run, "sh", ["-c", 'cat "$HOME/.claude.json"'], (r) => {
    try {
      const parsed = JSON.parse(r.stdout) as { oauthAccount?: unknown }
      return parsed.oauthAccount != null
    } catch {
      return false
    }
  })
}

/**
 * Reproduce today's Claude Code seeding: pre-seed `~/.claude.json` so the user
 * lands already onboarded (theme set, the "brokered" API-key placeholder
 * pre-approved, the checked-out worktree pre-trusted) and write a home-level
 * `~/.claude/CLAUDE.md` carrying the always-commit-and-push rule.
 *
 * The checkout location and writable home are provider-supplied, so the seed
 * follows the actual sandbox layout instead of a hardcoded backend path.
 * `homeDir` is the home of the unprivileged user these (non-`sudo`) writes — and
 * the interactive terminal shell — run as, so the seeded config is the same
 * `$HOME/.claude.json` that `claude` reads in the tmux session. These writes are
 * fire-and-forget (exit codes ignored), matching the prior behavior.
 */
async function seedClaudeCode(sandbox: SandboxInstance): Promise<void> {
  const { worktreePath, homeDir } = sandbox

  const claudeConfig = JSON.stringify({
    theme: "auto",
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: [BROKERED_VALUE], rejected: [] },
    projects: {
      [worktreePath]: {
        hasTrustDialogAccepted: true,
        projectOnboardingSeenCount: 1,
        allowedTools: [],
        mcpContextUris: [],
        mcpServers: {},
        enabledMcpjsonServers: [],
        disabledMcpjsonServers: [],
      },
    },
  })
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", `printf '%s' "$CLAUDE_CONFIG" > "${homeDir}/.claude.json"`],
    env: { CLAUDE_CONFIG: claudeConfig },
  })

  // User-level CLAUDE.md so every session in this sandbox inherits the
  // always-commit-and-push rule. Lives in the home dir (not the cloned repo)
  // so it doesn't pollute the user's git history.
  const claudeMd = commitAndPushRuleMarkdown()
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p "${homeDir}/.claude" && printf '%s' "$CLAUDE_MD" > "${homeDir}/.claude/CLAUDE.md"`,
    ],
    env: { CLAUDE_MD: claudeMd },
  })
}

/**
 * Claude Code's non-interactive print-mode call for the desktop
 * {@link import("../host-model").runHostModel} seam (#674). `claude -p
 * "<prompt>"` runs the prompt through the CLI's own signed-in model and prints
 * the reply to stdout (text output is the `-p` default), so the parse is a
 * trim: a non-empty reply is the model's text, an empty one is `null` — which
 * `runHostModel` collapses, with every other uncertainty, to a `null` result
 * the naming fallback degrades to. Exported for the descriptor test.
 */
export const claudeCodePrintModel: HarnessPrintModel = {
  buildArgv: (prompt) => ["claude", "-p", prompt],
  parseOutput: (stdout) => {
    const text = stdout.trim()
    return text.length > 0 ? text : null
  },
}

/**
 * The Claude Code harness — v1 tracer-bullet catalog entry. Brokered through
 * the Anthropic provider (`api.anthropic.com ← ANTHROPIC_API_KEY`); it targets
 * that host by default, so no base-url override is needed.
 */
export const claudeCodeHarness: Harness = {
  key: "claude-code",
  label: "Claude Code",
  installPackage: CLAUDE_CODE_INSTALL_PACKAGE,
  // The global install exposes the `claude` CLI on PATH.
  launchCommand: "claude",
  brokerProviderKey: "anthropic",
  gateEnvVar: "ANTHROPIC_API_KEY",
  launchArgv: ["claude"],
  // The desktop detector probes `claude` on PATH (the global install exposes it).
  hostBinary: "claude",
  // Backs agent chat via the actively-developed claude-agent ACP adapter —
  // rides the CLI's own login (no model key), per spikes #405/#408. Pinned to a
  // specific version: the adapter and the vendored `@agentclientprotocol/sdk`
  // (1.x) are a matched pair, so an unpinned `latest` could drift the wire out
  // from under the vendored schema. The predecessor `@zed-industries/claude-code-acp`
  // (frozen at 0.16.2) was renamed to `@agentclientprotocol/claude-agent-acp`
  // (#638); the zed-scoped package is deprecated.
  acpAdapter: {
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.54.1"],
    // It advertises a `model` config option and validates the value lazily: a
    // model the login can't run fails the first prompt, and the session falls
    // back to the adapter's default (ADR 0011).
    modelOption: "model",
    // A prompt sent while a turn runs joins it, the way a message typed while
    // Claude Code works joins it in its own terminal (#1191). The adapter also
    // says so at initialize (`_meta.claudeCode.promptQueueing`).
    promptQueueing: true,
  },
  // Curated model floor for the desktop dropdown — authoritative; the model
  // catalog (#527) only appends discovered-once-and-cached live models on top.
  // The ids are the Claude Code model aliases (https://code.claude.com/docs/en/model-config):
  // `opus` is the pre-selected per-Harness default. `fable` selects the most
  // capable model (Fable 5.1, always 1M context). Aliases track the latest version
  // of each family, so this floor doesn't pin a dated model id. We don't expose a
  // `default` alias entry: the bare `harness:claude-code` row (no `:model` suffix)
  // already means "ride the CLI's own default" and stays backward-compatible.
  //
  // This list is the desktop fold (`harnessModels` runs only on the local
  // backend), where the claude-agent adapter rides the *user's own Claude login*
  // (subscription) — not the hosted backend's brokered API key. No `[1m]` context
  // variants: the ACP adapter exposes context window as a derived property
  // (`DEFAULT_CONTEXT_WINDOW`, refreshed from usage), not a selectable model, so a
  // `sonnet[1m]`/`opus[1m]` pick isn't advertised and falls through
  // `maybeSetModel` to the default. The 1M-capable choice is `fable`. `opusplan`
  // is omitted too: it's the interactive CLI's plan/execute hybrid, with no
  // analogue over the ACP adapter.
  models: [
    { id: "fable", label: "Fable 5.1" },
    { id: "opus", label: "Opus 5.5" },
    { id: "sonnet", label: "Sonnet 5.5" },
    { id: "haiku", label: "Haiku 4.5" },
  ],
  defaultModelId: "opus",
  seed: seedClaudeCode,
  // Desktop "Coding agents" setup (ADR 0015): probe the CLI's own Claude login,
  // build its install command from the host facts (npm-free installer preferred),
  // and run its interactive sign-in verbatim in the setup terminal's PTY.
  probeAuth: probeClaudeCodeAuth,
  buildInstallCommand: buildClaudeCodeInstallCommand,
  // `claude /login` runs the CLI's browser sign-in and exits when it resolves —
  // the PTY exit is the setup step's completion signal to re-detect. The stored
  // credential it writes is exactly what `probeClaudeCodeAuth` reads back.
  authCommand: ["claude", "/login"],
  // One-shot non-interactive model call for desktop naming (rides the user's
  // own Claude login, no hosted key) — see `runHostModel` (#674).
  printModel: claudeCodePrintModel,
}
