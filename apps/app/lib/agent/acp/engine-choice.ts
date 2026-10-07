import { decodeHarnessModelId } from "@/lib/agent/harnesses/model-id"
import { backendSwitch, buildIdentity } from "@/lib/capabilities"

/**
 * Which Engine implementation drives a Chat Session (ADR 0006, PRD #375). The
 * choice is **minimal and explicit**: a per-deployment env var, *not* a
 * per-Chat-Session schema column, so a deployment runs entirely on one engine
 * and the decision never has to migrate data or branch per row.
 */
export type EngineChoice = "in-process" | "external"

/** The env var name a deployment sets to pick the engine. */
export const ENGINE_ENV_VAR = "AGENT_ENGINE"

/**
 * Read the engine choice from the environment, defaulting to `in-process` (the
 * established, self-contained default). Only the explicit value `external` opts
 * into the external engine; anything else (unset, empty, or unrecognised) stays
 * on the default, so a typo never silently swaps engines.
 */
export function engineChoiceFromEnv(
  env: Record<string, string | undefined> = process.env
): EngineChoice {
  return backendSwitch(ENGINE_ENV_VAR, env) === "external"
    ? "external"
    : "in-process"
}

/**
 * The **default** harness whose ACP adapter backs the external engine for a chat
 * with **no stored harness id**.
 *
 * A chat picks its own Harness through its stored `model` id (`harness:<key>`,
 * read by {@link decodeHarnessModelId}); this env var is the fallback for a chat
 * that hasn't — no longer "the one harness" for every chat (#479). The value is a
 * Harness **catalog key** (`claude-code`, `codex`) — the same key that names the
 * Terminal Tab and the `harness:` model id, since the per-CLI adapter is folded
 * into the one descriptor (#476) with no separate adapter-key namespace. Default
 * `claude-code` — the Claude Code adapter, which rides the user's existing login
 * with no model key (PRD #404).
 */
export const ACP_HARNESS_ENV_VAR = "SCREENPLAY_ACP_HARNESS"
const DEFAULT_ACP_HARNESS = "claude-code"

/** Read the configured ACP harness key, defaulting to `claude-code`. */
export function acpHarnessFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  return env[ACP_HARNESS_ENV_VAR]?.trim() || DEFAULT_ACP_HARNESS
}

/**
 * The Harness that runs a turn on `model`, or `null` when no Harness does: off
 * the desktop build, or on the in-process engine. `model` is the chat's model
 * id, which picks the Harness as it does in `resolveLiveEngine`.
 */
export function turnHarnessKey(
  model: string | undefined,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (engineChoiceFromEnv(env) !== "external" || buildIdentity === "account")
    return null
  return decodeHarnessModelId(model)?.key ?? acpHarnessFromEnv(env)
}
