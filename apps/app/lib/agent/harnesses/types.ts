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
 * Wire-format prefix marking a chat's stored `model` id as a **Harness
 * selection** (`harness:<key>`) rather than a `provider:<model>` id. The same
 * `harness:` form names the Terminal Tab key and the Harness catalog key — there
 * is no separate adapter-key namespace (#476). The model dropdown emits these on
 * the desktop backend, the external engine reads them back to pick the adapter
 * (#479), and `agent_chat.model` persists them verbatim.
 *
 * Lives in this leaf (rather than `acp/engine-select`, which reads it back) so
 * the model-enumeration fold can build harness ids without pulling the engine
 * graph in. `engine-select` re-exports it for its existing consumers.
 */
export const HARNESS_ID_PREFIX = "harness:"

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

/**
 * The argv that spawns a harness's **ACP adapter** as a host subprocess over
 * stdio — the wire the external Engine's `SpawnAcpSessionFactory` speaks to. It
 * lives on the descriptor (not a separate adapter map) so a CLI's terminal
 * launch and its chat backing read the *one* catalog entry: there is no second
 * adapter-key namespace. `null` for a terminal-only harness with no ACP adapter
 * (e.g. the opencode slots today), which the chat-capability filter drops.
 */
export interface AcpAdapter {
  /** Executable to spawn (e.g. `npx`). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Fold a chosen model id into the adapter's spawn argv, for Harnesses whose
   * ACP adapter does **not** advertise/honor ACP-native model selection
   * (`unstable_setSessionModel`) and so must take their model at launch instead
   * (spike #523). Codex advertises no `availableModels`, so it carries the choice
   * as a `--model <id>` spawn arg; claude-code is ACP-native and omits this, so
   * its model is applied in-session via {@link import("../acp/session").AcpSession}
   * rather than at spawn. Returns the extra args to append after {@link args};
   * absent or called with no model ⇒ no extra args, so a Harness with no stored
   * model spawns exactly as before. The spawn path applies this; the in-session
   * `setSessionModel` path is a no-op for these adapters (no models advertised),
   * so the two never double-apply.
   */
  modelArgs?(modelId: string): string[]
}

/**
 * One model a Harness can run, as the desktop chat model dropdown lists it. The
 * `id` is the **opaque ACP model alias** (e.g. `default`/`sonnet`/`opus` for
 * claude-code) carried on `agent_chat.model` as `harness:<key>:<id>` — it may
 * itself contain colons; the codec splits only on the first colon after the key
 * so it survives intact (`decodeHarnessModelId`). The descriptor's {@link
 * Harness.models} is the **curated floor**; the {@link
 * import("./model-catalog").HarnessModelCatalog} reads it through and may append a
 * discovered-once-and-cached live model on top, but the dropdown code path is
 * identical either way (#522/#527).
 */
export interface HarnessModel {
  /** Opaque ACP model alias selecting a model within the Harness. */
  id: string
  /** Human-readable label shown nested under the Harness's dropdown heading. */
  label: string
}

/**
 * A coding-harness descriptor. The flat catalog in `index.ts` is an array of
 * these keyed by `key`, mirroring the model-provider registry
 * (`lib/agent/providers`): teach the system a new harness by dropping a
 * descriptor in the array — the selection fold, brokered-env fold, and
 * installer all generalize over it for free.
 */
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
   * once and lists whichever slots are configured.
   */
  hostBinary: string

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
   * session's `availableModels` — it's the descriptor's **curated floor** (#523),
   * which the {@link import("./model-catalog").HarnessModelCatalog} treats as
   * authoritative and only appends discovered-once-and-cached live models on top
   * of (#527).
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
