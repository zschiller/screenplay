import "server-only"

import type { LanguageModel } from "ai"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import {
  harnessAvailability,
  harnessModels,
} from "@/lib/agent/harnesses/availability"
import { getAnthropicProvider } from "./anthropic"
import { getGoogleProvider } from "./google"
import { getOpenAIProvider } from "./openai"
import { getOpenAICompatibleProvider } from "./openai-compatible"
import { getVercelGatewayProvider } from "./vercel"
import type { ModelInfo, ModelProvider } from "./types"

export type { ModelInfo, ModelProvider } from "./types"

/**
 * The active set of model providers. Edit this list to add a new provider:
 * 1. Drop a sibling file under `lib/agent/providers/` exporting a factory
 *    that returns a `ModelProvider`.
 * 2. Import it here and add it to the array.
 *
 * Each provider self-detects whether it's enabled via env vars, so an
 * uninhabited entry (no API key set) just contributes nothing to the
 * picker — there's no need to add/remove from this list per deployment.
 *
 * Order matters: providers earlier in the list show first in the picker.
 */
const PROVIDERS: ModelProvider[] = [
  getAnthropicProvider(),
  getOpenAIProvider(),
  getGoogleProvider(),
  getVercelGatewayProvider(),
  getOpenAICompatibleProvider(),
]

const PROVIDERS_BY_KEY = new Map<string, ModelProvider>(
  PROVIDERS.map((p) => [p.key, p])
)

/**
 * The configured provider registry, in picker order. Exposed so the sandbox
 * egress-policy builder (`lib/sandbox/network-policy.ts`) can fold over it.
 * Returns the shared instances — treat them as read-only.
 */
export function getModelProviders(): ModelProvider[] {
  return PROVIDERS
}

/**
 * Default model used when a caller doesn't pass one. Override per
 * deployment via `AGENT_DEFAULT_MODEL`. The value is a fully-qualified
 * `<provider>:<model>` id — there's no implicit provider, so a deployment
 * configured only for OpenAI must set this to e.g. `openai:gpt-4o`.
 */
export const DEFAULT_MODEL =
  process.env.AGENT_DEFAULT_MODEL || "anthropic:claude-sonnet-4-6"

export function parseModelId(id: string): {
  providerKey: string
  model: string
} {
  const idx = id.indexOf(":")
  if (idx === -1) {
    throw new Error(
      `Model id "${id}" is missing a provider prefix. Use "<provider>:<model>", e.g. "anthropic:claude-sonnet-4-6".`
    )
  }
  return { providerKey: id.slice(0, idx), model: id.slice(idx + 1) }
}

export function resolveLanguageModel(modelId: string): LanguageModel {
  const { providerKey, model } = parseModelId(modelId)
  const provider = PROVIDERS_BY_KEY.get(providerKey)
  if (!provider) {
    throw new Error(
      `Unknown provider "${providerKey}" in model id "${modelId}". Available: ${PROVIDERS.map((p) => p.key).join(", ")}.`
    )
  }
  return provider.resolve(model)
}

/**
 * The **hosted** enumeration fold: flat list of every model from every
 * configured provider, in registry order, each decorated with its origin
 * provider's metadata so the client can group by provider rather than by model
 * family (the per-provider `listModels()` implementations don't populate this
 * themselves). Each provider discovers live via its own API and caches (see
 * `./cache.ts`); one whose upstream is unreachable falls back to a small curated
 * list rather than blocking the whole catalog. Takes the registry explicitly so
 * the fold is testable without the env-derived singleton.
 */
export async function providerModels(
  providers: ModelProvider[]
): Promise<ModelInfo[]> {
  const lists = await Promise.all(
    providers.map(async (p) => {
      const models = await p.listModels()
      return models.map((m) => ({
        ...m,
        provider: { key: p.key, label: p.label },
      }))
    })
  )
  return lists.flat()
}

/**
 * The **hosted** default fold: `AGENT_DEFAULT_MODEL` when its provider is
 * configured, else the first enabled model (e.g. a deployment that set only
 * `OPENAI_API_KEY` but left `AGENT_DEFAULT_MODEL` at its anthropic default), else
 * `null` when nothing is configured. Pure given the registry, the already-folded
 * `models`, and the configured default — so no hardcoded constant survives when
 * its provider isn't present. Reused by {@link getDefaultModelId} for the hosted
 * backend.
 */
export function providerDefaultModelId(
  providers: ModelProvider[],
  models: ModelInfo[],
  defaultModel: string = DEFAULT_MODEL
): string | null {
  const byKey = new Map(providers.map((p) => [p.key, p]))
  try {
    const { providerKey } = parseModelId(defaultModel)
    if (byKey.get(providerKey)?.isConfigured()) return defaultModel
  } catch {
    // Malformed AGENT_DEFAULT_MODEL — fall through to the first-enabled fallback.
  }
  return models[0]?.id ?? null
}

/**
 * Backend-uniform model enumeration, resolved through the same build-time switch
 * that picks the {@link harnessAvailability} seam and the `SandboxProvider`
 * (ADR 0003). The **desktop** backend folds detected harnesses into `harness:`
 * entries grouped as "Installed agents"; the **hosted** backend folds the
 * configured provider registry into `provider:` models as before. The dropdown
 * and the terminal new-tab picker therefore read the *one* per-backend answer and
 * can never drift apart.
 */
export async function enumerateModels(): Promise<ModelInfo[]> {
  if (isLocalSandboxBackend())
    return harnessModels(await harnessAvailability.list())
  return providerModels(PROVIDERS)
}

/**
 * The default model id for this deployment, always sourced through the seam.
 * On the **desktop** backend it's the first detected chat-capable harness's
 * `harness:` id (or `null` when none is detected) — the hardcoded anthropic
 * `DEFAULT_MODEL` is hosted-only and is never returned here, so no constant can
 * name an agent the deployment doesn't have. On the **hosted** backend it's the
 * configured provider default (see {@link providerDefaultModelId}). Returns
 * `null` when the backend offers nothing.
 */
export async function getDefaultModelId(): Promise<string | null> {
  if (isLocalSandboxBackend()) {
    const models = harnessModels(await harnessAvailability.list())
    return models[0]?.id ?? null
  }
  return providerDefaultModelId(PROVIDERS, await providerModels(PROVIDERS))
}
