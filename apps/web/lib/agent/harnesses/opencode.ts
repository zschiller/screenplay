import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import { commitAndPushRuleMarkdown, type Harness } from "./types"

/**
 * opencode is the provider/model-agnostic harness for the two OpenAI-protocol
 * slots — the Vercel AI Gateway and an arbitrary OpenAI-compatible endpoint —
 * where there is no "official" vendor CLI. Both slots install the same binary
 * (`opencode-ai` on npm, `opencode` on PATH) and differ only in the endpoint
 * they point at and the provider that brokers their auth.
 */
const OPENCODE_PACKAGE = "opencode-ai"

/** opencode's global config + agents file live under `~/.config/opencode`. */
const opencodeConfigDir = (homeDir: string) => `${homeDir}/.config/opencode`

/**
 * Build opencode's global config JSON for an OpenAI-protocol slot. opencode is
 * model-agnostic: it loads the AI SDK's `@ai-sdk/openai-compatible` adapter and
 * points it at the slot's endpoint, authenticating with a Bearer token. Both
 * the base URL and the API key are `{env:…}` refs, so opencode reads them from
 * the sandbox boot env that `buildBrokeredEnv` emits — a *dummy* key (the
 * firewall injects the real one on egress, ADR 0002) plus the endpoint
 * override. Kept as a pure builder so a unit test can assert the seed string
 * without a sandbox. Written verbatim to `~/.config/opencode/opencode.json`.
 */
export function opencodeConfigJson(opts: {
  providerId: string
  providerLabel: string
  baseUrlEnv: string
  apiKeyEnv: string
  models?: Record<string, { name: string }>
  defaultModel?: string
}): string {
  const provider: Record<string, unknown> = {
    npm: "@ai-sdk/openai-compatible",
    name: opts.providerLabel,
    options: {
      baseURL: `{env:${opts.baseUrlEnv}}`,
      apiKey: `{env:${opts.apiKeyEnv}}`,
    },
  }
  if (opts.models) provider.models = opts.models

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    provider: { [opts.providerId]: provider },
  }
  if (opts.defaultModel) config.model = opts.defaultModel

  return JSON.stringify(config, null, 2)
}

/**
 * Reproduce opencode's in-sandbox setup for a slot: write its global config
 * (pointed at the slot's endpoint via env refs) and a *home-level* `AGENTS.md`
 * carrying the always-commit-and-push rule. The agents file is the global one
 * under `~/.config/opencode`, never the cloned repo's root `AGENTS.md`, so it
 * doesn't pollute git history. Both writes target `homeDir` — the unprivileged
 * user's `$HOME` that `opencode` reads in the tmux session — and are
 * fire-and-forget (exit codes ignored), matching the claude-code/codex seeds.
 *
 * Both opencode slots share one binary and one global config path; if an
 * operator selects both, the later seed's config wins. Fine in practice — the
 * slots are alternatives, each gated on its own broker provider being
 * configured.
 */
function seedOpencode(configJson: string) {
  return async (sandbox: SandboxInstance): Promise<void> => {
    const dir = opencodeConfigDir(sandbox.homeDir)

    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p "${dir}" && printf '%s' "$OPENCODE_CONFIG" > "${dir}/opencode.json"`,
      ],
      env: { OPENCODE_CONFIG: configJson },
    })

    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p "${dir}" && printf '%s' "$OPENCODE_AGENTS_MD" > "${dir}/AGENTS.md"`,
      ],
      env: { OPENCODE_AGENTS_MD: commitAndPushRuleMarkdown() },
    })
  }
}

/**
 * opencode pointed at the Vercel AI Gateway. Brokered through the `vercel`
 * provider (`ai-gateway.vercel.sh ← AI_GATEWAY_API_KEY`); the gateway speaks the
 * OpenAI protocol at `/v1`, so opencode reaches it through the openai-compatible
 * adapter. The base-url override is a constant (the gateway host never varies).
 */
export const opencodeGatewayHarness: Harness = {
  key: "opencode-gateway",
  label: "opencode (Vercel AI Gateway)",
  installPackage: OPENCODE_PACKAGE,
  // The global install exposes the `opencode` CLI on PATH.
  launchCommand: "opencode",
  brokerProviderKey: "vercel",
  gateEnvVar: "AI_GATEWAY_API_KEY",
  baseUrlEnv: {
    name: "OPENCODE_GATEWAY_BASE_URL",
    value: "https://ai-gateway.vercel.sh/v1",
  },
  launchArgv: ["opencode"],
  seed: seedOpencode(
    opencodeConfigJson({
      providerId: "gateway",
      providerLabel: "Vercel AI Gateway",
      baseUrlEnv: "OPENCODE_GATEWAY_BASE_URL",
      apiKeyEnv: "AI_GATEWAY_API_KEY",
      models: {
        "anthropic/claude-sonnet-4-6": { name: "Claude Sonnet 4.6" },
        "openai/gpt-4o": { name: "GPT-4o" },
      },
      defaultModel: "gateway/anthropic/claude-sonnet-4-6",
    }),
  ),
}

/**
 * opencode pointed at an arbitrary OpenAI-compatible endpoint
 * (`OPENAI_COMPATIBLE_BASE_URL`). Brokered through the `compat` provider, whose
 * `egress()` returns null when `OPENAI_COMPATIBLE_API_KEY` is unset — so the
 * selection fold skips this slot (logged, non-fatal) on a key-less deployment.
 *
 * The endpoint is deployment-specific, so the base-url override passes through
 * `OPENAI_COMPATIBLE_BASE_URL` to the sandbox. It's read here when the catalog
 * module loads, which on the server is process start — the value is fixed for
 * the process's lifetime, like every other env-derived config. No default model
 * is baked in: the operator's endpoint fronts unknown models, so opencode
 * discovers/selects them at runtime.
 */
export const opencodeCompatHarness: Harness = {
  key: "opencode-compat",
  label: "opencode (OpenAI-compatible)",
  installPackage: OPENCODE_PACKAGE,
  // The global install exposes the `opencode` CLI on PATH.
  launchCommand: "opencode",
  brokerProviderKey: "compat",
  gateEnvVar: "OPENAI_COMPATIBLE_API_KEY",
  baseUrlEnv: {
    name: "OPENAI_COMPATIBLE_BASE_URL",
    value: process.env.OPENAI_COMPATIBLE_BASE_URL ?? "",
  },
  launchArgv: ["opencode"],
  seed: seedOpencode(
    opencodeConfigJson({
      providerId: "compat",
      providerLabel: "OpenAI-compatible",
      baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    }),
  ),
}
