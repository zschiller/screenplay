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
 * Auth: set `AI_GATEWAY_API_KEY` — generate one from your project's AI
 * Gateway dashboard. The OIDC token Vercel injects on deploys is *not*
 * accepted by the gateway in practice, so we don't treat its presence as
 * sufficient configuration.
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
    return Boolean(process.env.AI_GATEWAY_API_KEY)
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

  egress() {
    const key = process.env.AI_GATEWAY_API_KEY
    if (!key) return null
    // The gateway SDK routes through https://ai-gateway.vercel.sh; broker the
    // Bearer token at that host so a sandbox harness reaches it keyless.
    return {
      host: "ai-gateway.vercel.sh",
      headers: { authorization: `Bearer ${key}` },
    }
  }

  private client(): GatewayClient {
    if (this.cached) return this.cached
    this.cached = createGateway()
    return this.cached
  }
}

export function getVercelGatewayProvider(): ModelProvider {
  return new VercelAIGatewayProvider()
}
