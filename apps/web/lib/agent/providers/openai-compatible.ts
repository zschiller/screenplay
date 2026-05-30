import "server-only"

import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible"
import { discover } from "./cache"
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
 *
 * Models are discovered live via `${BASE_URL}/v1/models`. Most servers
 * implement the endpoint; the few that don't get a small curated fallback
 * (just generic gpt-4o-style ids that probably won't resolve, but the
 * dropdown shows something rather than blank).
 *
 * For the Vercel AI Gateway specifically, use the `vercel` provider
 * (`vercel.ts` in this folder) instead — it uses Vercel's dedicated SDK
 * and gets you OIDC auth on Vercel deploys, budgets, analytics, failover,
 * and BYOK.
 */
class OpenAICompatibleProviderImpl implements ModelProvider {
  key = "compat"
  label = "OpenAI-compatible"
  private cached: OpenAICompatibleProvider | null = null

  isConfigured() {
    return Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL)
  }

  async listModels() {
    if (!this.isConfigured()) return []
    const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL!
    return discover({
      // Cache key includes baseURL so a deployment that changes its
      // gateway endpoint doesn't keep serving the previous one's catalog.
      cacheKey: `providers:openai-compatible:models:${baseURL}`,
      fetchLive: async () => {
        const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY
        const url = baseURL.replace(/\/$/, "") + "/v1/models"
        const res = await fetch(url, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        })
        if (!res.ok) {
          throw new Error(
            `${url} returned ${res.status} — server may not implement /v1/models`,
          )
        }
        const data = (await res.json()) as {
          data?: Array<{ id: string; name?: string }>
        }
        const entries = data.data ?? []
        return entries.map((m) => ({
          id: `compat:${m.id}`,
          label: m.name ?? m.id,
        }))
      },
      // No useful curated fallback for an arbitrary endpoint we know
      // nothing about — empty list means the dropdown just shows the
      // section as empty if the live fetch fails.
      fallback: [],
    })
  }

  resolve(modelId: string) {
    return this.client()(modelId)
  }

  egress() {
    const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL
    const key = process.env.OPENAI_COMPATIBLE_API_KEY
    // Nothing to broker without a key — unauthenticated local servers (LM
    // Studio, vLLM) carry no secret the firewall needs to inject.
    if (!baseURL || !key) return null
    let host: string
    try {
      host = new URL(baseURL).hostname
    } catch {
      return null
    }
    return { host, headers: { authorization: `Bearer ${key}` } }
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
