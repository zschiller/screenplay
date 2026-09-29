import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import {
  commitAndPushRuleMarkdown,
  type Harness,
  type HarnessProcessRunner,
  type HostFacts,
} from "./types"
import { probeOk } from "./process-runner"

/**
 * opencode is the provider/model-agnostic harness for the two OpenAI-protocol
 * slots — the Vercel AI Gateway and an arbitrary OpenAI-compatible endpoint —
 * where there is no "official" vendor CLI. Both slots install the same binary
 * (`opencode-ai` on npm, `opencode` on PATH) and differ only in the endpoint
 * they point at and the provider that brokers their auth.
 */
export const OPENCODE_INSTALL_PACKAGE = "opencode-ai"

/**
 * opencode's official no-`npm` installer. Piped to `bash`, it lands an `opencode`
 * binary in the install dir — no `sudo` — the same deterministic-path move
 * claude-code's and `gh`'s binary fallbacks use.
 */
export const OPENCODE_INSTALL_SCRIPT_URL = "https://opencode.ai/install"

/**
 * The install dir we hand opencode's installer via `OPENCODE_INSTALL_DIR` (its
 * highest-priority path override, ahead of its own `~/.opencode/bin` default) so
 * the binary lands in `~/.local/bin` — already on the sidecar's augmented `PATH`
 * (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same session and
 * every later one. `$HOME` is expanded by the shell running the command, so the
 * builder needs no home-dir lookup of its own.
 */
export const OPENCODE_INSTALL_DIR = "$HOME/.local/bin"

/**
 * opencode's {@link Harness.buildInstallCommand} (ADR 0015): the pure mapping
 * from host facts → the install command run in the inline setup terminal:
 *
 * - **`npm` present** → `npm install -g opencode-ai`, the global install that
 *   exposes `opencode` on `PATH` (the fallback path).
 * - **No `npm`** → opencode's own `curl … | bash` installer, so a host with no
 *   `node`/`npm` never dead-ends (ADR 0015: the vendor installer is the npm-free
 *   preference). `OPENCODE_INSTALL_DIR` pins the binary to `~/.local/bin`, no
 *   `sudo`.
 *
 * Only `npmPresent` is consulted today; the wider {@link HostFacts} is taken so
 * the signature matches the descriptor's `buildInstallCommand` and a later
 * arch-specific path can read `arch` without a shape change.
 */
function buildOpencodeInstallCommand(facts: HostFacts): string {
  if (facts.npmPresent) return `npm install -g ${OPENCODE_INSTALL_PACKAGE}`
  return `OPENCODE_INSTALL_DIR="${OPENCODE_INSTALL_DIR}" curl -fsSL ${OPENCODE_INSTALL_SCRIPT_URL} | bash`
}

/**
 * opencode stores every configured provider's credential in a single JSON object
 * under its data dir, defaulting to `~/.local/share/opencode/auth.json`
 * (XDG-overridable via `XDG_DATA_HOME`). The shell expands `$XDG_DATA_HOME`/`$HOME`,
 * so the probe needs no home-dir lookup of its own.
 */
const OPENCODE_AUTH_JSON_PATH =
  '"${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"'

/**
 * Whether `opencode auth list`'s output names at least one **configured
 * provider**. opencode prints one entry per stored credential; when nothing is
 * configured it prints an empty list or a "no credentials" notice. Honest
 * degradation (never a false "connected"): the header path line (`Credentials
 * <…/auth.json>`) and any "no …" empty-state message are *not* evidence, so the
 * probe reads authed only when some other content line — an actual provider entry
 * — is present.
 */
function listsConfiguredProvider(stdout: string): boolean {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .some((line) => {
      // An empty-state notice ("No credentials found", "no providers", …).
      if (/\bno\b.*\b(credential|provider|account|auth)/i.test(line)) {
        return false
      }
      // The "Credentials <path>" header, which names the auth.json file itself.
      if (/auth\.json/i.test(line)) return false
      return true
    })
}

/**
 * Whether opencode's `auth.json` holds a configured provider. The file is a JSON
 * object keyed by provider id; a non-empty object means at least one provider is
 * signed in. An empty object (`{}`) or unparseable content degrades to *not
 * authed* — the honest-degradation rule, so a stale/empty store never reads as
 * connected.
 */
function authJsonHasProvider(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as unknown
    return (
      parsed != null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed as Record<string, unknown>).length > 0
    )
  } catch {
    return false
  }
}

/**
 * Whether opencode carries a configured provider on the desktop host — the two
 * opencode slots' shared per-descriptor {@link Harness.probeAuth} (ADR 0015),
 * driven through the injected process runner so a fake runner tests it. Two
 * independent signals, short-circuiting on the first hit:
 *
 *  1. `opencode auth list` names a configured provider ({@link
 *     listsConfiguredProvider});
 *  2. the credential store under the opencode data dir
 *     (`~/.local/share/opencode/auth.json`) holds one ({@link
 *     authJsonHasProvider}) — the fallback for when the CLI can't enumerate but
 *     the file is readable.
 *
 * Any indeterminate result degrades to *not authed* (see {@link probeOk}); the
 * probe resolves `true` only when one signal positively holds a provider.
 */
export async function probeOpencodeAuth(
  run: HarnessProcessRunner
): Promise<boolean> {
  // 1. The CLI's own view of its credential store.
  if (
    await probeOk(run, "opencode", ["auth", "list"], (r) =>
      listsConfiguredProvider(r.stdout)
    )
  ) {
    return true
  }

  // 2. The credential store on disk, read directly (a present, non-empty object).
  return probeOk(run, "sh", ["-c", `cat ${OPENCODE_AUTH_JSON_PATH}`], (r) =>
    authJsonHasProvider(r.stdout)
  )
}

/**
 * The desktop "Coding agents" setup trio shared by **both** opencode slots (ADR
 * 0015): one binary, one install, one login. The setup surface already collapses
 * the two slots to a single `opencode` row keyed on `hostBinary`
 * (the **Harness Setup** module's rows), so whichever slot is the row's representative
 * carries the same probe/install/sign-in — spread into each descriptor so they
 * stay identical by construction.
 */
const opencodeSetup = {
  probeAuth: probeOpencodeAuth,
  buildInstallCommand: buildOpencodeInstallCommand,
  // `opencode auth login` runs the CLI's provider sign-in (a browser/OAuth or
  // device flow shown in the terminal) and exits when it resolves — the PTY exit
  // is the setup step's completion signal to re-detect. The credential it writes
  // under the opencode data dir is exactly what `probeOpencodeAuth` reads back.
  authCommand: ["opencode", "auth", "login"],
} satisfies Pick<Harness, "probeAuth" | "buildInstallCommand" | "authCommand">

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
  installPackage: OPENCODE_INSTALL_PACKAGE,
  // The global install exposes the `opencode` CLI on PATH.
  launchCommand: "opencode",
  brokerProviderKey: "vercel",
  gateEnvVar: "AI_GATEWAY_API_KEY",
  baseUrlEnv: {
    name: "OPENCODE_GATEWAY_BASE_URL",
    value: "https://ai-gateway.vercel.sh/v1",
  },
  launchArgv: ["opencode"],
  // Both opencode slots share one host binary; detection probes `opencode` once.
  hostBinary: "opencode",
  // Terminal-only today: no ACP adapter wired, so the chat-capability filter
  // drops it (opencode backs the Terminal Tab, not the external Engine).
  acpAdapter: null,
  seed: seedOpencode(
    opencodeConfigJson({
      providerId: "gateway",
      providerLabel: "Vercel AI Gateway",
      baseUrlEnv: "OPENCODE_GATEWAY_BASE_URL",
      apiKeyEnv: "AI_GATEWAY_API_KEY",
      models: {
        "anthropic/claude-sonnet-5.5": { name: "Claude Sonnet 5.5" },
        "openai/gpt-6-astra": { name: "GPT-6 Astra" },
      },
      defaultModel: "gateway/anthropic/claude-sonnet-5.5",
    })
  ),
  ...opencodeSetup,
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
  installPackage: OPENCODE_INSTALL_PACKAGE,
  // The global install exposes the `opencode` CLI on PATH.
  launchCommand: "opencode",
  brokerProviderKey: "compat",
  gateEnvVar: "OPENAI_COMPATIBLE_API_KEY",
  baseUrlEnv: {
    name: "OPENAI_COMPATIBLE_BASE_URL",
    value: process.env.OPENAI_COMPATIBLE_BASE_URL ?? "",
  },
  launchArgv: ["opencode"],
  // Both opencode slots share one host binary; detection probes `opencode` once.
  hostBinary: "opencode",
  // Terminal-only today: no ACP adapter wired, so the chat-capability filter
  // drops it (opencode backs the Terminal Tab, not the external Engine).
  acpAdapter: null,
  seed: seedOpencode(
    opencodeConfigJson({
      providerId: "compat",
      providerLabel: "OpenAI-compatible",
      baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL",
      apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
    })
  ),
  ...opencodeSetup,
}
