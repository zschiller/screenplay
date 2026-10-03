import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import {
  commitAndPushRuleMarkdown,
  type Harness,
  type HarnessPrintModel,
  type HarnessProcessRunner,
  type HostFacts,
} from "./types"

/**
 * The custom model-provider key written into `~/.codex/config.toml` and selected
 * by `model_provider`. Codex's built-in `openai` provider prefers ChatGPT OAuth
 * login; a *named custom* provider carrying an `env_key` forces the API-key path
 * so the CLI boots straight to a prompt under the brokered key instead of a
 * login wizard.
 */
const CODEX_PROVIDER_KEY = "screenplay-openai"

/**
 * Run one credential probe through the injected runner, collapsing every
 * uncertainty to a boolean: a process that ran and satisfied `ok` → `true`;
 * anything else — non-zero exit, empty output, or a spawn failure (the binary
 * isn't there / the file is absent) — → `false`. This is the honest-degradation
 * rule (ADR 0015), the same shape as Claude Code's `probeOk`: a probe that can't
 * confirm a login reports *not authed*, so the worst case is offering a sign-in
 * the user didn't strictly need, never a false "connected".
 */
async function probeOk(
  run: HarnessProcessRunner,
  cmd: string,
  args: string[],
  ok: (result: { exitCode: number; stdout: string }) => boolean
): Promise<boolean> {
  try {
    const result = await run(cmd, args)
    return result.exitCode === 0 && ok(result)
  } catch {
    return false
  }
}

/**
 * Whether Codex's own login is present on the desktop host — Codex's
 * per-descriptor {@link Harness.probeAuth} (ADR 0015). Checked through the
 * injected process runner (so a fake runner drives it in tests),
 * short-circuiting on the first hit:
 *
 *  1. `~/.codex/auth.json` holds a credential — written by `codex login`;
 *  2. `CODEX_API_KEY` is set in the environment — the API-key path.
 *
 * Any indeterminate result degrades to *not authed* (see {@link probeOk}); the
 * whole probe resolves `true` only when one signal positively holds.
 */
export async function probeCodexAuth(
  run: HarnessProcessRunner
): Promise<boolean> {
  const nonEmpty = (r: { stdout: string }) => r.stdout.trim() !== ""

  // 1. The credential file `codex login` writes (`$HOME` expanded by the shell,
  //    so the probe needs no home-dir lookup of its own).
  if (
    await probeOk(run, "sh", ["-c", 'cat "$HOME/.codex/auth.json"'], nonEmpty)
  ) {
    return true
  }

  // 2. CODEX_API_KEY in the environment — `printf` the var and treat a non-empty
  //    value as authed (an unset var expands to empty → not authed).
  return probeOk(run, "sh", ["-c", 'printf %s "$CODEX_API_KEY"'], nonEmpty)
}

/** The npm package the `npm install -g` path installs (the `codex` binary). */
export const CODEX_INSTALL_PACKAGE = "@openai/codex"

/**
 * Codex's GitHub release-download base — the `latest` channel, so the installer
 * tracks the newest release without pinning a dated tag.
 */
export const CODEX_RELEASE_BASE_URL =
  "https://github.com/openai/codex/releases/latest/download"

/**
 * The macOS release-asset target triple for a host `arch`. Codex ships one
 * self-contained binary per target; the primary desktop target is Apple-silicon
 * (`arm64` → `aarch64-apple-darwin`), with the Intel target for an `x64` host.
 * Anything else falls back to the arm64 asset — the surface is macOS-only, and
 * the arm64 build is the one the acceptance path exercises.
 */
function codexReleaseTarget(arch: string): string {
  return arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin"
}

/**
 * Codex's official no-`npm` install: download the macOS release binary and land
 * a `codex` executable in `~/.local/bin` — already on the sidecar's augmented
 * `PATH` (`desktop/src-tauri/src/sidecar.rs`), so it resolves in this same
 * session and every later one — with no `sudo`, the same deterministic-path move
 * Claude Code's and the `gh` binary fallbacks use. The release tarball holds a
 * single target-named binary, so it's renamed to the plain `codex` the launch
 * command runs.
 */
function buildCodexBinaryInstall(arch: string): string {
  const target = codexReleaseTarget(arch)
  const asset = `codex-${target}.tar.gz`
  const bin = `"$HOME/.local/bin"`
  return (
    `mkdir -p ${bin} && ` +
    `curl -fsSL ${CODEX_RELEASE_BASE_URL}/${asset} | tar xz -C ${bin} && ` +
    `mv ${bin}/codex-${target} ${bin}/codex && ` +
    `chmod +x ${bin}/codex`
  )
}

/**
 * Codex's {@link Harness.buildInstallCommand} (ADR 0015): the pure mapping from
 * host facts → the install command run in the inline setup terminal. Codex is
 * the harness that exercises the full install-branch variety — the reason
 * {@link HostFacts} carries `brewPresent` and `arch` on top of `npmPresent` —
 * checked in host-fit order so a host never dead-ends and no path needs `sudo`:
 *
 * - **Homebrew present** → `brew install codex`, the native macOS package path.
 * - **No `brew`, `npm` present** → `npm i -g @openai/codex`, the global install
 *   that exposes `codex` on `PATH`.
 * - **Neither** → Codex's own macOS release binary into `~/.local/bin` (ADR
 *   0015: the vendor's npm-free path), so a host with no `brew`/`npm` still
 *   installs, no `sudo`.
 */
function buildCodexInstallCommand(facts: HostFacts): string {
  if (facts.brewPresent) return "brew install codex"
  if (facts.npmPresent) return `npm i -g ${CODEX_INSTALL_PACKAGE}`
  return buildCodexBinaryInstall(facts.arch)
}

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
 * Codex's non-interactive print-mode call for the desktop
 * {@link import("../host-model").runHostModel} seam (#674/#679). Codex's headless
 * form is `codex exec "<prompt>"` (not a `-p` flag like Claude Code) — the per-
 * harness print-argv field exists precisely because each CLI's non-interactive
 * invocation differs. By default `codex exec` streams its activity (progress,
 * token usage) to **stderr** and writes only the model's final message to
 * **stdout**, so — like `claude -p` — the parse is a trim: a non-empty reply is
 * the model's text, an empty one is `null`, which `runHostModel` collapses (with
 * every other uncertainty) to the `null` the naming fallback degrades to. The
 * prompt is a single positional argv element, never shell-interpolated. Exported
 * for the descriptor test.
 */
export const codexPrintModel: HarnessPrintModel = {
  buildArgv: (prompt) => ["codex", "exec", prompt],
  parseOutput: (stdout) => {
    const text = stdout.trim()
    return text.length > 0 ? text : null
  },
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
  installPackage: CODEX_INSTALL_PACKAGE,
  // The global install exposes the `codex` CLI on PATH.
  launchCommand: "codex",
  brokerProviderKey: "openai",
  gateEnvVar: "OPENAI_API_KEY",
  launchArgv: ["codex"],
  // The desktop detector probes `codex` on PATH (the global install exposes it).
  hostBinary: "codex",
  // User Skills; `~/.codex/skills` is Codex's older, still-read folder, and
  // its `.system` holds the skills Codex ships.
  ownSkills: {
    agentName: "Codex",
    dirs: [".agents/skills", ".codex/skills", ".codex/skills/.system"],
  },
  // Backs agent chat via the maintained codex ACP adapter (#1271), which rides
  // `codex login` / `CODEX_API_KEY` like the CLI does. It is built on the Codex
  // App Server and bundles a current Codex core, so today's models run.
  // Pinned so a new adapter release can't change the tool-call contract under us.
  acpAdapter: {
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp@2.0.1"],
    // It advertises a `model` config option and validates the value eagerly:
    // `set_config_option` rejects a model it doesn't offer, and the session
    // stays on the adapter's default (ADR 0011).
    modelOption: "model",
    // A second prompt doesn't join the running turn; a mid-turn message goes
    // through the adapter's steering request instead (#1192).
    promptQueueing: false,
  },
  // Curated model floor for the desktop dropdown — authoritative; the model
  // catalog (#527) only appends discovered-once-and-cached live models on top.
  // The ids are Codex's model slugs (the values of the adapter's `model` config
  // option and `config.toml`'s `model`, https://developers.openai.com/codex/models). `gpt-6-astra`
  // is the most capable and the pre-selected per-Harness default; `gpt-6-luna`
  // is the efficient tier. `gpt-5.5` stays until Codex retires it (2026-10-14).
  // `gpt-6.1-sol` is left out while its rollout is still partial.
  models: [
    { id: "gpt-6-astra", label: "GPT-6 Astra" },
    { id: "gpt-6-luna", label: "GPT-6 Luna" },
    { id: "gpt-5.5", label: "GPT-5.5" },
  ],
  defaultModelId: "gpt-6-astra",
  seed: seedCodex,
  // Desktop "Coding agents" setup (ADR 0015): probe `codex login`'s own stored
  // credential, build its install command from the host facts (brew / release
  // binary / npm — the full install-branch variety), and run `codex login`
  // verbatim in the setup terminal's PTY.
  probeAuth: probeCodexAuth,
  buildInstallCommand: buildCodexInstallCommand,
  // `codex login` runs the CLI's browser/device sign-in and exits when it
  // resolves — the PTY exit is the setup step's completion signal to re-detect.
  // The credential it writes (`~/.codex/auth.json`) is exactly what
  // `probeCodexAuth` reads back.
  authCommand: ["codex", "login"],
  // One-shot non-interactive model call for desktop naming (rides `codex login` /
  // the brokered key, no separate hosted key) — see `runHostModel` (#674). Codex
  // is chat-capable (non-null `acpAdapter`), so a desktop user whose first
  // detected chat-capable harness is Codex now gets model-backed naming through
  // the same seam (#679).
  printModel: codexPrintModel,
}
