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
 * A coding-harness descriptor. The flat catalog in `index.ts` is an array of
 * these keyed by `key`, mirroring the model-provider registry
 * (`lib/agent/providers`): teach the system a new harness by dropping a
 * descriptor in the array — the selection fold, brokered-env fold, and
 * installer all generalize over it for free.
 */
export interface Harness {
  /**
   * Stable key named in `SANDBOX_HARNESSES` (comma-separated). Must not contain
   * a comma. Once an operator deploys with it, it's part of the config wire
   * format — don't rename it.
   */
  key: string

  /** Human-readable label shown in docs / config UIs. */
  label: string

  /** npm package installed globally via `npm install -g <installPackage>`. */
  installPackage: string

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
