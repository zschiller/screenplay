import { ExternalEngine, type ExternalEngineConfig } from "./acp-engine"
import type { Engine } from "./engine-seam"
import { inProcessEngine } from "./in-process-engine"

/**
 * Which Engine implementation drives a Chat Session (ADR 0006, PRD #375). Two
 * implementations justify a selection mechanism; the chosen surface is
 * deliberately **minimal and explicit** — a per-deployment env var, *not* a
 * per-Chat-Session schema column — so a deployment runs entirely on one engine
 * and the decision never has to migrate data or branch per row.
 */
export type EngineChoice = "in-process" | "external"

/** The env var name a deployment sets to pick the engine. */
export const ENGINE_ENV_VAR = "AGENT_ENGINE"

/**
 * Wire-format prefix marking a chat's stored `model` id as a **Harness
 * selection** (`harness:<key>`) rather than a `provider:<model>` id. The same
 * `harness:` form names the Terminal Tab key and the Harness catalog key — there
 * is no separate adapter-key namespace (#476).
 */
export const HARNESS_ID_PREFIX = "harness:"

/**
 * The Harness catalog key a chat's stored `model` id names for the **external
 * engine** to spawn, or `null` when the id doesn't pick one. A `harness:<key>`
 * id yields `<key>`; anything else — a `provider:<model>` id, an empty/whitespace
 * id, or none — yields `null`, leaving the caller on its env default.
 *
 * This only ever picks the *adapter*; it never picks the *engine*. Which engine
 * runs stays a per-deployment build-time choice ({@link engineChoiceFromEnv},
 * ADR 0006): a `provider:` id can't promote a chat onto the external engine, and
 * a `harness:` id can't appear on an in-process deployment. So `null` here means
 * "fall back to the `SCREENPLAY_ACP_HARNESS` default", not "switch engines".
 */
export function harnessKeyFromModelId(
  modelId: string | undefined | null
): string | null {
  const trimmed = modelId?.trim()
  if (!trimmed || !trimmed.startsWith(HARNESS_ID_PREFIX)) return null
  return trimmed.slice(HARNESS_ID_PREFIX.length).trim() || null
}

/**
 * Read the engine choice from the environment, defaulting to `in-process` (the
 * established, self-contained default). Only the explicit value `external` opts
 * into the external engine; anything else — unset, empty, or unrecognised — stays
 * on the default, so a typo never silently swaps engines.
 */
export function engineChoiceFromEnv(
  env: Record<string, string | undefined> = process.env
): EngineChoice {
  return env[ENGINE_ENV_VAR] === "external" ? "external" : "in-process"
}

/**
 * Resolve the {@link Engine} for the current deployment. The in-process engine
 * is self-contained; the external engine needs an {@link ExternalEngineConfig}
 * (the session factory that reaches a real ACP agent). When `AGENT_ENGINE=external`
 * is set without that config wired, this throws rather than silently falling back —
 * an operator who asked for the external engine should hear that its transport
 * isn't configured, not get the in-process engine unannounced.
 */
export function selectEngine(deps: { external?: ExternalEngineConfig } = {}): Engine {
  if (engineChoiceFromEnv() === "external") {
    if (!deps.external) {
      throw new Error(
        `${ENGINE_ENV_VAR}=external but no ACP session factory is configured (the production ACP transport lands in a later slice)`
      )
    }
    return new ExternalEngine(deps.external)
  }
  return inProcessEngine
}
