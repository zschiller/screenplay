import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"

/**
 * Dummy value emitted for every harness's gate env var. The harness gates on
 * the var being *present* at boot — the value never matters, because the
 * sandbox firewall overwrites the auth header with the real provider key on
 * egress (see ADR 0002 and `lib/sandbox/network-policy.ts`). The same literal
 * is pre-approved in Claude Code's onboarding seed so the CLI doesn't prompt.
 */
export const BROKERED_VALUE = "brokered"

/**
 * The always-commit-and-push rule, as markdown. Every harness seeds this into
 * its own *home-level* agents file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`,
 * …) so each session inherits the rule without it ever being written into the
 * cloned repo's root `AGENTS.md` — keeping the user's git history clean. Shared
 * here so the wording stays identical across harnesses.
 */
export function commitAndPushRuleMarkdown(): string {
  return [
    "# Screenplay sandbox rules",
    "",
    "## CRITICAL — always commit and push after changes",
    "",
    "After ANY file change, you MUST run these three commands before ending your turn. Never skip. This is the most important rule.",
    "",
    "1. `git add -A`",
    '2. `git commit -m "<concise description of changes>"`',
    "3. `git push`",
    "",
    "If you do not push, the user will not see your changes in the Screenplay UI. Always push.",
    "",
  ].join("\n")
}

/** How an ACP adapter plans (see {@link AcpAdapter.plan}). */
export type PlanStyle = "mode" | "collaboration" | "reply"

/**
 * A harness's **ACP adapter**: the argv that spawns it as a host subprocess over
 * stdio (the wire the external Engine's `SpawnAcpSessionFactory` speaks to), and
 * the facts about it the session needs. It lives on the descriptor (not a
 * separate adapter map) so a CLI's terminal launch and its chat backing read the
 * *one* catalog entry, and a change for one Harness is a change to its one file.
 * `null` for a terminal-only harness with no ACP adapter, which the
 * chat-capability filter drops.
 */
export interface AcpAdapter {
  /** Executable to spawn (e.g. `npx`). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * How the adapter takes the chat's model (ADR 0011): the id of the session
   * config option it advertises as its model selector. The session applies the
   * model in-session with `session/set_config_option` on this option once the
   * session opens; nothing about the model rides the spawn.
   */
  modelOption: string
  /**
   * Whether the adapter takes a further `session/prompt` while one runs and
   * folds it into the live turn (#1191). ACP has no standard capability for
   * this, so it is stated here rather than read from an adapter's own `_meta`.
   * With it, a Steer joins the running turn as another prompt.
   */
  promptQueueing: boolean
  /**
   * How the adapter plans, which picks the session's plan protocol
   * (`choosePlanProtocol` in `acp/plan-protocol`):
   *
   *  - `"mode"`: a native `plan` session mode, gated on its request to leave
   *    it (Claude Code's ExitPlanMode, spike #408).
   *  - `"collaboration"`: a `collaboration_mode` config option, gated on the
   *    request to carry out the plan that holds it in `rawInput.plan` (Codex,
   *    #1337).
   *  - `"reply"`: a `mode` config option whose plan agent ends the turn with
   *    the plan as its answer and never asks to carry it out (opencode, #1589).
   *
   * Stated rather than detected, so it wins over what the adapter advertises.
   * Absent ⇒ read from what it advertises.
   */
  plan?: PlanStyle
  /**
   * How the agent names a tool it reaches over MCP from `server`, when that
   * name is fixed: Claude Code's `mcp__<server>__<tool>`, opencode's
   * `<server>_<tool>`. A prompt then names Screenplay's tools exactly
   * (#1223). Absent ⇒ the names vary by version (Codex), so a prompt keeps the
   * bare names and says where they come from.
   */
  mcpToolName?(server: string, tool: string): string
  /**
   * The env that lets the adapter read `directories` (the chat's context
   * folder, #1524) without asking, for an adapter that takes them through
   * its own config rather than ACP `additionalDirectories` (#1589). Given
   * the child's env, so it can keep what that already sets. Absent ⇒ none.
   */
  directoriesEnv?(
    directories: string[],
    env: Record<string, string>
  ): Record<string, string>
}

/**
 * One model a Harness can run, as the desktop chat model dropdown lists it. The
 * `id` is the **opaque ACP model alias** (e.g. `default`/`sonnet`/`opus` for
 * claude-code) carried on `agent_chat.model` as `harness:<key>:<id>` — it may
 * itself contain colons; the codec splits only on the first colon after the key
 * so it survives intact (`decodeHarnessModelId`). The descriptor's {@link
 * Harness.models} is the **curated floor** the dropdown lists (#522).
 */
export interface HarnessModel {
  /** Opaque ACP model alias selecting a model within the Harness. */
  id: string
  /** Human-readable label shown nested under the Harness's dropdown heading. */
  label: string
}

/**
 * A harness's **non-interactive print-mode** invocation — the seam the desktop
 * {@link import("../host-model").runHostModel} primitive uses to run a one-shot
 * prompt through the user's own installed, already-signed-in CLI (`claude -p
 * "<prompt>"`) with no hosted API key (#674). It lives on the descriptor as a
 * sibling of {@link Harness.authCommand} / {@link Harness.buildInstallCommand},
 * so teaching a new harness to name things is a catalog change, not a naming
 * change.
 *
 * Two pure steps: {@link buildArgv} produces the print-mode argv for a prompt,
 * and {@link parseOutput} maps the CLI's stdout back to the model's text.
 * Best-effort by contract — {@link parseOutput} returns `null` for empty or
 * unusable output, which `runHostModel` collapses (with a spawn failure /
 * non-zero exit / timeout) to a single `null` result the naming fallback
 * degrades to.
 */
export interface HarnessPrintModel {
  /**
   * Build the non-interactive print-mode argv that runs `prompt` through the
   * CLI (e.g. `["claude", "-p", prompt]`). The first element is the executable
   * (`hostBinary`); the prompt is passed as a single argv element, never
   * shell-interpolated.
   */
  buildArgv(prompt: string): string[]
  /**
   * Parse the CLI's stdout into the model's reply text, or `null` when the
   * output is empty / unusable. Honest degradation: an unparseable reply is a
   * `null`, never a fabricated name.
   */
  parseOutput(stdout: string): string | null
}

/**
 * One model a Harness can run, as its CLI lists it for people to choose from in
 * Settings (#1589): `id` is the opaque model id the ACP session's model option
 * takes, `label` its name, and `group` the provider it comes from, which the
 * chooser groups by.
 */
export interface HarnessModelChoice {
  id: string
  label: string
  group: string
}

/**
 * A CLI call that lists every model the Harness can run with the user's own
 * sign-ins (`opencode models --verbose`), for a Harness whose models are too
 * many to curate. The Settings row offers Choose models when it's set.
 */
export interface HarnessModelList {
  /** The argv, `hostBinary` first. */
  argv: string[]
  /** Parse its stdout; anything unreadable is left out, never guessed. */
  parse(stdout: string): HarnessModelChoice[]
}

/**
 * The host-process boundary a harness's {@link Harness.probeAuth} shells
 * through, injected so the auth probe is unit-testable without a real CLI
 * install or a real credential store — the exact mockable-seam shape as the
 * `gh` adapter's `GhProcessRunner` (ADR 0015). Resolves with the exit code +
 * output for a process that ran; **rejects** when the binary can't be spawned at
 * all (ENOENT), which an honest probe maps to *not authed* rather than a false
 * "connected".
 */
export type HarnessProcessRunner = (
  cmd: string,
  args: string[]
) => Promise<{ exitCode: number; stdout: string }>

/**
 * The host facts a harness's {@link Harness.buildInstallCommand} maps to the
 * shell command the inline setup terminal runs (ADR 0015) — the sibling of the
 * `{ brewPresent }` input `gh-install-command.ts` takes, widened for harnesses
 * that may install off `npm` or a per-arch release binary. Probed live on the
 * desktop host just before an install (`npm`/`brew` via the same `command -v`
 * prober host-binary detection uses; `arch` from the Node runtime).
 */
export interface HostFacts {
  /** Whether `npm` is on the host `PATH` (the `npm install -g` path is viable). */
  npmPresent: boolean
  /** Whether Homebrew is on the host `PATH` (a `brew install` path is viable). */
  brewPresent: boolean
  /** The host CPU architecture (`process.arch`, e.g. `arm64`) for a release-binary URL. */
  arch: string
}

/**
 * A coding-harness descriptor. The flat catalog in `index.ts` is an array of
 * these keyed by `key`, mirroring the model-provider registry
 * (`lib/agent/providers`): teach the system a new harness by dropping a
 * descriptor in the array — the selection fold, brokered-env fold, and
 * installer all generalize over it for free.
 */
/** See {@link Harness.ownSkills}. */
export interface HarnessOwnSkills {
  /** How the `/` menu names the agent, e.g. "Claude Code". */
  agentName: string
  /** Skill folders relative to the home folder, e.g. `.claude/skills`; a
   *  trailing `/*` means every folder inside one. */
  dirs: readonly string[]
}

export interface Harness {
  /**
   * Stable key named in `SANDBOX_HARNESSES` (comma-separated). Must contain
   * neither a comma (it's the list separator) nor a colon (it's the model-id
   * codec's separator — see `isValidHarnessKey` / `decodeHarnessModelId` in
   * `./model-id`). Once an operator deploys with it, it's part of the config
   * wire format — don't rename it.
   */
  key: string

  /** Human-readable label shown in docs / config UIs. */
  label: string

  /** npm package installed globally via `npm install -g <installPackage>`. */
  installPackage: string

  /**
   * Shell command that starts the harness CLI in the terminal (e.g. `claude`).
   * A terminal tab stores the harness *key*, not this command — the server
   * resolves key → launch argv from the catalog at connect time, so the launch
   * command can change here without rewriting persisted rows. It is wrapped as
   * `sh -c '<launchCommand>; exec $SHELL'` (see `resolveLaunchArgv`) so quitting
   * the harness (Ctrl-D) drops the operator into a normal shell in the same
   * persistent tmux session rather than killing the tab.
   */
  launchCommand: string

  /**
   * Key of the model provider whose egress brokers this harness's API auth. A
   * harness is only installable when this provider is configured AND its
   * `egress()` is header-brokerable (non-null) — that's the firewall rule that
   * lets the harness reach its API without ever holding the real key.
   */
  brokerProviderKey: string

  /**
   * Env var the harness gates on at boot (e.g. `ANTHROPIC_API_KEY`).
   * `buildBrokeredEnv` emits `<gateEnvVar>=<BROKERED_VALUE>` — a dummy, never a
   * real key — so the harness boots and the firewall injects the real key on
   * egress.
   */
  gateEnvVar: string

  /**
   * Optional base-url override emitted into the boot env so the harness points
   * at the brokered host (e.g. a harness that defaults elsewhere). Omitted when
   * the harness already targets its provider's host by default.
   */
  baseUrlEnv?: { name: string; value: string }

  /**
   * Argv that launches the harness CLI in an interactive terminal tab — the
   * binary plus any flags needed to boot it past first-run gates. The first
   * element is the executable installed by `installPackage` (e.g. `["claude"]`,
   * `["codex"]`). Exposed via `harnessLaunchArgv(key)` for the terminal/default-
   * tab plumbing; kept on the descriptor so a new harness ships its launch
   * command alongside its install + seed.
   */
  launchArgv: string[]

  /**
   * Binary name the **desktop** Harness Availability resolver probes on the host
   * `PATH` (`command -v <hostBinary>`) to decide whether this CLI is installed —
   * no broker, no install (the CLI rides its own login). Usually the same string
   * as {@link launchCommand}, but kept distinct: `launchCommand` is *what a
   * terminal tab runs*, `hostBinary` is *what detection looks for*. The two
   * opencode slots share one `hostBinary` (`opencode`), so detection probes it
   * once and the desktop lists it once, under {@link hostLabel}.
   */
  hostBinary: string

  /**
   * The name the **desktop** app shows for this CLI, when it differs from
   * {@link label}: there the CLI rides its own login, so a hosted slot's
   * broker in the label means nothing (the opencode slots are both
   * "OpenCode" on desktop). Absent ⇒ {@link label}.
   */
  hostLabel?: string

  /**
   * The agent's own Skills on the desktop host (#1560): its name as the `/`
   * menu shows it, and the folders under the user's home it loads Skills from
   * itself, first wins. Screenplay only lists and reads them, never writes.
   */
  ownSkills?: HarnessOwnSkills

  /**
   * The ACP adapter spawn argv for backing **agent chat** on the external Engine
   * (folds in the retired adapter map), or `null` for a terminal-only harness
   * that has no ACP adapter. The chat-capability filter
   * (`availability.filterByCapability(..., "chat")`) keeps only entries whose
   * `acpAdapter` is non-null; the terminal filter keeps all.
   */
  acpAdapter: AcpAdapter | null

  /**
   * The curated, static list of models this Harness can run, shown nested under
   * the Harness's own heading in the desktop chat model dropdown. Each entry
   * becomes a `harness:<key>:<id>` `ModelInfo`. Empty/omitted ⇒ the Harness
   * degrades to a single selectable "harness default" entry (bare
   * `harness:<key>`), so the dropdown never regresses below the harness-picker
   * behavior. `enumerateModels` is stateless, so this list can never be a live
   * session's `availableModels` — it's the descriptor's **curated floor**
   * (#523), and the dropdown lists exactly it.
   *
   * A model-list refresh changes these, the provider `FALLBACK` lists
   * (`lib/agent/providers`), `availability.test.ts` and the list in the docs'
   * `guides/agent.mdx` together.
   */
  models?: HarnessModel[]

  /**
   * The Harness's pre-selected default model — the `id` of an entry in
   * {@link models}. The dropdown sits on it per Harness, and the first detected
   * Harness's default is the overall desktop default. Curated on the descriptor,
   * never read from a live `currentModelId` (an enumeration is stateless;
   * reconciling against the live session is a session-open concern, #526).
   * Omitted when {@link models} is empty (the bare-`harness:<key>` default).
   */
  defaultModelId?: string

  /**
   * Reproduce the harness's in-sandbox setup after install (onboarding state,
   * config files, …). Best-effort: runs as the unprivileged sandbox user, so
   * it writes under `sandbox.homeDir` / `sandbox.worktreePath`.
   */
  seed(sandbox: SandboxInstance): Promise<void>

  /**
   * Probe whether this harness's **own login** is present on the desktop host
   * (ADR 0015) — the auth fact the "Coding agents" Settings surface surfaces
   * per row, additively on top of presence. There is no shared `auth token`
   * command across harnesses (each stores its credential differently), so the
   * probe is per-descriptor, modeled on `GhCli.getStatus` with an **injected
   * process runner** so it is unit-testable with a fake. Honest degradation: an
   * indeterminate probe resolves `false` (offer sign-in), never a false "authed".
   *
   * Omitted for a harness whose login this slice doesn't yet probe — the setup
   * surface then reports `authenticated: null` ("can't tell") and still lists it
   * on presence (the Harness Availability invariant: presence lists, auth is
   * surfaced, never a pre-filter).
   */
  probeAuth?(run: HarnessProcessRunner): Promise<boolean>

  /**
   * Build the shell command the inline setup terminal runs to **install** this
   * CLI, from the live {@link HostFacts} (ADR 0015) — an optional pure builder,
   * the sibling of `gh-install-command.ts`. It prefers the vendor's own no-`npm`
   * installer so a host without `npm` never dead-ends, falling back to
   * `npm install -g <installPackage>` only when `npm` is present. Chained ahead
   * of {@link authCommand} in one terminal session, so a failed install stops
   * before sign-in with its error on screen and the row re-detects to
   * "Not installed". Omitted for a harness with no in-app install path.
   */
  buildInstallCommand?(facts: HostFacts): string

  /**
   * The CLI's own interactive login argv, run verbatim in the setup terminal's
   * PTY (ADR 0015) — Claude Code's login, `codex login`, `opencode auth login`.
   * The visible-terminal UX (a browser flow / device code shown in the terminal)
   * is the CLI's; PTY exit is the completion signal to re-detect. Omitted for a
   * harness with no in-app sign-in path.
   */
  authCommand?: string[]

  /**
   * The CLI's **non-interactive print-mode** call (`claude -p "<prompt>"`),
   * used by the desktop {@link import("../host-model").runHostModel} seam to
   * reach a model on the host for one-shot work (tab/branch naming today) with
   * no hosted API key (#674). Omitted for a harness with no print mode — the
   * seam skips such a harness and the caller falls back to the deterministic
   * slug. See {@link HarnessPrintModel}.
   */
  printModel?: HarnessPrintModel

  /**
   * Lists the models people can choose to show in the model menu, for a
   * Harness with no curated {@link models} because it reaches too many
   * (OpenCode, #1589). Omitted when the curated list is the whole story.
   */
  modelList?: HarnessModelList
}

/** A harness named in `SANDBOX_HARNESSES` that won't be installed, with why. */
export interface SkippedHarness {
  key: string
  reason: string
}

/** Outcome of the selection fold: what to install, and what was dropped. */
export interface HarnessSelection {
  installable: Harness[]
  skipped: SkippedHarness[]
}
