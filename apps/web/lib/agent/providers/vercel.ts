import "server-only"

import { createGateway } from "ai"
import { discover } from "./cache"
import type { ModelInfo, ModelProvider } from "./types"

type GatewayClient = ReturnType<typeof createGateway>

const FALLBACK: Array<Omit<ModelInfo, "provider">> = [
  { id: "vercel:anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "vercel:openai/gpt-4o", label: "GPT-4o" },
  { id: "vercel:google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
]

/**
 * Vercel AI Gateway provider. Routes through https://ai-gateway.vercel.sh,
 * which exposes hundreds of models behind a unified API and adds
 * Vercel-specific features on top: budgets, per-user/tag analytics,
 * automatic failover, BYOK, and zero-config OIDC auth on Vercel deploys.
 *
 * Auth:
 * - On Vercel deploys, the OIDC token is injected automatically — no env
 *   var needed.
 * - Locally, set `AI_GATEWAY_API_KEY` (Vercel's standard) — generate one
 *   from your project's AI Gateway dashboard.
 *
 * Models are discovered live via `gateway.getAvailableModels()`, filtered
 * to language models. The full id stored in `agent_chat.model` is
 * `vercel:<provider>/<model>` — e.g. `vercel:anthropic/claude-sonnet-4-7`.
 */
class VercelAIGatewayProvider implements ModelProvider {
  key = "vercel"
  label = "Vercel AI Gateway"
  private cached: GatewayClient | null = null

  isConfigured() {
    return Boolean(
      process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
    )
  }

  async listModels() {
    if (!this.isConfigured()) return []
    return discover({
      cacheKey: "providers:vercel-gateway:models",
      fetchLive: async () => {
        const { models } = await this.client().getAvailableModels()
        return models
          .filter((m) => (m.modelType ?? "language") === "language")
          .map((m) => ({
            id: `vercel:${m.id}`,
            label: m.name,
          }))
      },
      fallback: FALLBACK,
    })
  }

  resolve(modelId: string) {
    return this.client()(modelId)
  }

  private client(): GatewayClient {
    if (this.cached) return this.cached
    // createGateway picks up AI_GATEWAY_API_KEY automatically and falls back
    // to VERCEL_OIDC_TOKEN on Vercel deploys, so no explicit args needed in
    // either path.
    this.cached = createGateway()
    return this.cached
  }
}

export function getVercelGatewayProvider(): ModelProvider {
  return new VercelAIGatewayProvider()
}
