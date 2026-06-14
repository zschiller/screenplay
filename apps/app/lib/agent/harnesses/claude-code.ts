import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import {
  BROKERED_VALUE,
  commitAndPushRuleMarkdown,
  type Harness,
} from "./types"

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
 * The Claude Code harness — v1 tracer-bullet catalog entry. Brokered through
 * the Anthropic provider (`api.anthropic.com ← ANTHROPIC_API_KEY`); it targets
 * that host by default, so no base-url override is needed.
 */
export const claudeCodeHarness: Harness = {
  key: "claude-code",
  label: "Claude Code",
  installPackage: "@anthropic-ai/claude-code",
  // The global install exposes the `claude` CLI on PATH.
  launchCommand: "claude",
  brokerProviderKey: "anthropic",
  gateEnvVar: "ANTHROPIC_API_KEY",
  launchArgv: ["claude"],
  // The desktop detector probes `claude` on PATH (the global install exposes it).
  hostBinary: "claude",
  // Backs agent chat via the Zed claude-code ACP adapter — rides the CLI's own
  // login (no model key), per spikes #405/#408.
  acpAdapter: {
    command: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
  },
  // Curated model floor for the desktop dropdown — authoritative; the model
  // catalog (#527) only appends discovered-once-and-cached live models on top.
  // The ids are the Claude Code model aliases (https://code.claude.com/docs/en/model-config):
  // `default` rides the CLI's own recommended model, so it is the pre-selected
  // per-Harness default and is backward-compatible with the bare
  // `harness:claude-code` rows stored before this list existed. `fable` selects
  // the most capable model (Fable 5). The `[1m]` suffix selects the 1M-token
  // context window (`opus[1m]` / `sonnet[1m]`). Aliases track the latest version
  // of each family, so this floor doesn't pin a dated model id. `opusplan` is
  // omitted: it is the interactive CLI's plan-mode/execute-mode hybrid, which has
  // no analogue over the ACP adapter backing this Harness's chat.
  models: [
    { id: "default", label: "Default" },
    { id: "fable", label: "Fable" },
    { id: "opus", label: "Opus" },
    { id: "opus[1m]", label: "Opus (1M context)" },
    { id: "sonnet", label: "Sonnet" },
    { id: "sonnet[1m]", label: "Sonnet (1M context)" },
    { id: "haiku", label: "Haiku" },
  ],
  defaultModelId: "default",
  seed: seedClaudeCode,
}
