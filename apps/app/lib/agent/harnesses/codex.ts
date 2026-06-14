import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import { commitAndPushRuleMarkdown, type Harness } from "./types"

/**
 * The custom model-provider key written into `~/.codex/config.toml` and selected
 * by `model_provider`. Codex's built-in `openai` provider prefers ChatGPT OAuth
 * login; a *named custom* provider carrying an `env_key` forces the API-key path
 * so the CLI boots straight to a prompt under the brokered key instead of a
 * login wizard.
 */
const CODEX_PROVIDER_KEY = "screenplay-openai"

/**
 * Body of `~/.codex/config.toml`. Points Codex at a custom OpenAI provider whose
 * `base_url` is the brokered host and whose `env_key` names the gate var holding
 * the dummy `brokered` placeholder — the sandbox firewall swaps in the real
 * `OPENAI_API_KEY` on egress (ADR 0002), so Codex never holds it. The
 * `approval_policy` / `sandbox_mode` presets boot past Codex's first-run
 * approval + sandbox gates so a fresh tab lands at a ready prompt rather than a
 * wizard. Kept as a pure builder so a unit test can assert the seed string
 * without a sandbox.
 */
export function codexConfigToml(): string {
  return [
    `model_provider = "${CODEX_PROVIDER_KEY}"`,
    `approval_policy = "never"`,
    `sandbox_mode = "danger-full-access"`,
    ``,
    `[model_providers.${CODEX_PROVIDER_KEY}]`,
    `name = "OpenAI (brokered by Screenplay)"`,
    `base_url = "https://api.openai.com/v1"`,
    `env_key = "OPENAI_API_KEY"`,
    `wire_api = "responses"`,
    ``,
  ].join("\n")
}

/**
 * Reproduce Codex's in-sandbox setup after install: write `~/.codex/config.toml`
 * (the brokered custom provider + approval presets, see {@link codexConfigToml})
 * and a *home-level* `~/.codex/AGENTS.md` carrying the always-commit-and-push
 * rule. The rule lives in Codex's home agents file — never the repo root
 * `AGENTS.md` — so it isn't committed into the user's git history.
 *
 * `homeDir` is provider-supplied (not a hardcoded backend path) and is the home
 * of the same unprivileged user the interactive terminal shell runs as, so the
 * seeded `$HOME/.codex` is exactly what `codex` reads in the tmux session. These
 * writes are fire-and-forget (exit codes ignored), matching the claude-code seed.
 */
async function seedCodex(sandbox: SandboxInstance): Promise<void> {
  const { homeDir } = sandbox

  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p "${homeDir}/.codex" && printf '%s' "$CODEX_CONFIG" > "${homeDir}/.codex/config.toml"`,
    ],
    env: { CODEX_CONFIG: codexConfigToml() },
  })

  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p "${homeDir}/.codex" && printf '%s' "$CODEX_AGENTS_MD" > "${homeDir}/.codex/AGENTS.md"`,
    ],
    env: { CODEX_AGENTS_MD: commitAndPushRuleMarkdown() },
  })
}

/**
 * The Codex harness — OpenAI's native vendor CLI for the native OpenAI slot.
 * Brokered through the OpenAI provider (`api.openai.com ← OPENAI_API_KEY`):
 * naming `codex` in `SANDBOX_HARNESSES` installs it only when OpenAI is
 * configured and header-brokerable, otherwise the selection fold skips it with a
 * log line. Codex reads its host from the seeded `config.toml`, so no base-url
 * boot-env override is needed.
 */
export const codexHarness: Harness = {
  key: "codex",
  label: "Codex",
  installPackage: "@openai/codex",
  // The global install exposes the `codex` CLI on PATH.
  launchCommand: "codex",
  brokerProviderKey: "openai",
  gateEnvVar: "OPENAI_API_KEY",
  launchArgv: ["codex"],
  // The desktop detector probes `codex` on PATH (the global install exposes it).
  hostBinary: "codex",
  // Backs agent chat via the Zed codex ACP adapter — rides `codex login` /
  // `CODEX_API_KEY`, per spike #405. The adapter advertises no `availableModels`
  // (spike #523), so a per-chat model choice can't ride ACP's in-session
  // `setSessionModel`; it's applied at spawn as `--model <id>` instead. Omitted
  // when no model is stored (bare `harness:codex`), so codex spawns unchanged.
  acpAdapter: {
    command: "npx",
    args: ["-y", "@zed-industries/codex-acp"],
    modelArgs: (modelId) => ["--model", modelId],
  },
  // Curated model list for the desktop dropdown (static for this slice — a
  // discovered-once-and-cached catalog is a later slice). The ids are Codex's
  // model slugs (the same names its `--model` flag / `config.toml` take); the
  // flagship `gpt-5-codex` is the pre-selected per-Harness default.
  models: [
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
  ],
  defaultModelId: "gpt-5-codex",
  seed: seedCodex,
}
