import "server-only"

import { createGateway } from "ai"
import type { ModelInfo, ModelProvider } from "./types"

type GatewayClient = ReturnType<typeof createGateway>

/**
 * Vercel AI Gateway provider. Routes through https://ai-gateway.vercel.sh,
 * which exposes hundreds of models behind a unified API and adds
 * Vercel-specific features on top: budgets, per-user/tag analytics,
 * automatic failover, BYOK, and zero-config OIDC auth on Vercel deploys.
 *
 * Auth:
 * - On Vercel deploys, the OIDC token is injected automatically (same as
 *   Vercel Sandbox) — no env var needed.
 * - Locally, set `AI_GATEWAY_API_KEY` (Vercel's standard) — generate one
 *   from your project's AI Gateway dashboard.
 *
 * Models: the Gateway exposes hundreds, so the picker shows a curated
 * popular subset by default. Override with `VERCEL_AI_GATEWAY_MODELS` to
 * expose a custom list — same comma-separated `id` or `id|label` format
 * as the OpenAI-compatible provider. Each id is the Gateway's
 * `<provider>/<model>` form, e.g. `anthropic/claude-sonnet-4-7`.
 *
 * The full id stored in `agent_chat.model` will be
 * `vercel:<provider>/<model>` — e.g. `vercel:anthropic/claude-sonnet-4-7`.
 */

const CURATED_MODELS: ModelInfo[] = [
  { id: "vercel:anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "vercel:anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "vercel:anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "vercel:openai/gpt-4o", label: "GPT-4o" },
  { id: "vercel:openai/o1", label: "o1" },
  { id: "vercel:google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "vercel:google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "vercel:meta/llama-3.3-70b", label: "Llama 3.3 70B" },
]

class VercelAIGatewayProvider implements ModelProvider {
  key = "vercel"
  label = "Vercel AI Gateway"
  private cached: GatewayClient | null = null

  isConfigured() {
    // Vercel injects an OIDC token automatically in their environment, so
    // we treat that as "configured" too. Explicit AI_GATEWAY_API_KEY for
    // local dev or other hosts.
    return Boolean(
      process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
    )
  }

  listModels(): ModelInfo[] {
    if (!this.isConfigured()) return []
    const raw = process.env.VERCEL_AI_GATEWAY_MODELS
    if (!raw) return CURATED_MODELS
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [id, label] = entry.split("|").map((s) => s.trim())
        return {
          id: `vercel:${id!}`,
          label: label ?? id!,
        }
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
