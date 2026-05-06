import "server-only"

import type { LanguageModel } from "ai"
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
  PROVIDERS.map((p) => [p.key, p]),
)

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
      `Model id "${id}" is missing a provider prefix. Use "<provider>:<model>", e.g. "anthropic:claude-sonnet-4-6".`,
    )
  }
  return { providerKey: id.slice(0, idx), model: id.slice(idx + 1) }
}

export function resolveLanguageModel(modelId: string): LanguageModel {
  const { providerKey, model } = parseModelId(modelId)
  const provider = PROVIDERS_BY_KEY.get(providerKey)
  if (!provider) {
    throw new Error(
      `Unknown provider "${providerKey}" in model id "${modelId}". Available: ${PROVIDERS.map((p) => p.key).join(", ")}.`,
    )
  }
  return provider.resolve(model)
}

/**
 * Flat list of every model from every configured provider, in
 * `PROVIDERS` order. Drives the model picker.
 */
export function enumerateModels(): ModelInfo[] {
  return PROVIDERS.flatMap((p) => p.listModels())
}
