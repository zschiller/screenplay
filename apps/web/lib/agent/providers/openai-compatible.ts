import "server-only"

import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible"
import type { ModelProvider } from "./types"

/**
 * Generic OpenAI-protocol provider. Points at any endpoint that speaks the
 * OpenAI HTTP protocol — OpenRouter, Groq, Together, an internal LiteLLM
 * proxy, vLLM, LM Studio, etc.
 *
 * Env vars:
 * - `OPENAI_COMPATIBLE_BASE_URL` — base URL of the endpoint.
 * - `OPENAI_COMPATIBLE_API_KEY`  — bearer token (optional for unauthenticated
 *   local servers like LM Studio).
 * - `OPENAI_COMPATIBLE_MODELS`   — comma-separated catalog the picker
 *   exposes, since there's no portable enumeration endpoint across
 *   compatible servers. Each entry is either `id` or `id|label`. Example:
 *   `meta-llama/llama-3.3-70b|Llama 3.3 70B,deepseek/deepseek-v3|DeepSeek V3`
 *
 * For the Vercel AI Gateway specifically, use the `vercel` provider
 * (`vercel.ts` in this folder) instead — it uses Vercel's dedicated
 * `@ai-sdk/gateway` SDK so you get OIDC auth on Vercel deploys, budgets,
 * analytics, failover, and BYOK.
 */
class OpenAICompatibleProviderImpl implements ModelProvider {
  key = "compat"
  label = "OpenAI-compatible"
  private cached: OpenAICompatibleProvider | null = null

  isConfigured() {
    return Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL)
  }

  listModels() {
    if (!this.isConfigured()) return []
    const raw = process.env.OPENAI_COMPATIBLE_MODELS
    if (!raw) return []
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [id, label] = entry.split("|").map((s) => s.trim())
        return {
          id: `compat:${id!}`,
          label: label ?? id!,
        }
      })
  }

  resolve(modelId: string) {
    return this.client()(modelId)
  }

  private client(): OpenAICompatibleProvider {
    if (this.cached) return this.cached
    const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL
    if (!baseURL) {
      throw new Error(
        "OPENAI_COMPATIBLE_BASE_URL is not set — the OpenAI-compatible provider isn't configured.",
      )
    }
    const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY
    this.cached = createOpenAICompatible({
      name: "compat",
      baseURL,
      ...(apiKey ? { apiKey } : {}),
    })
    return this.cached
  }
}

export function getOpenAICompatibleProvider(): ModelProvider {
  return new OpenAICompatibleProviderImpl()
}
