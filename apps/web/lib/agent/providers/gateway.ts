import "server-only"

import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible"
import type { ModelInfo, ModelProvider } from "./types"

/**
 * OpenAI-compatible gateway provider. Points at any endpoint that speaks
 * the OpenAI HTTP protocol — OpenRouter, Groq, Together, vLLM, LM Studio,
 * an internal LiteLLM proxy, etc.
 *
 * Env vars:
 * - `AI_GATEWAY_BASE_URL` — base URL of the OpenAI-compatible endpoint.
 * - `AI_GATEWAY_API_KEY`  — bearer token (optional for unauthenticated
 *   local servers like LM Studio).
 * - `AI_GATEWAY_MODELS`   — comma-separated catalog of models exposed in
 *   the picker, since there's no portable enumeration endpoint across
 *   compatible servers. Each entry is either `id` or `id|label`. Example:
 *   `meta-llama/llama-3.3-70b|Llama 3.3 70B,deepseek/deepseek-v3|DeepSeek V3`
 *
 * If you'd rather hit a specific gateway with its own SDK (e.g. OpenRouter
 * has a dedicated `@openrouter/ai-sdk-provider` package), drop a sibling
 * file modeled on `openai.ts` and add it to `index.ts` — there's nothing
 * special about this generic adapter beyond convenience.
 */
class GatewayProvider implements ModelProvider {
  key = "gateway"
  label = "Gateway"
  private cached: OpenAICompatibleProvider | null = null

  isConfigured() {
    return Boolean(process.env.AI_GATEWAY_BASE_URL)
  }

  listModels(): ModelInfo[] {
    if (!this.isConfigured()) return []
    const raw = process.env.AI_GATEWAY_MODELS
    if (!raw) return []
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [id, label] = entry.split("|").map((s) => s.trim())
        return {
          id: `gateway:${id!}`,
          label: label ?? id!,
        }
      })
  }

  resolve(modelId: string) {
    return this.client()(modelId)
  }

  private client(): OpenAICompatibleProvider {
    if (this.cached) return this.cached
    const baseURL = process.env.AI_GATEWAY_BASE_URL
    if (!baseURL) {
      throw new Error(
        "AI_GATEWAY_BASE_URL is not set — the gateway provider isn't configured.",
      )
    }
    const apiKey = process.env.AI_GATEWAY_API_KEY
    this.cached = createOpenAICompatible({
      name: "gateway",
      baseURL,
      ...(apiKey ? { apiKey } : {}),
    })
    return this.cached
  }
}

export function getGatewayProvider(): ModelProvider {
  return new GatewayProvider()
}
