import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import { discover } from "./cache"
import type { ModelInfo, ModelProvider } from "./types"

const FALLBACK: Array<Omit<ModelInfo, "provider">> = [
  { id: "anthropic:claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "anthropic:claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "anthropic:claude-haiku-4-5", label: "Claude Haiku 4.5" },
]

interface AnthropicListResponse {
  data: Array<{
    id: string
    display_name?: string
    type?: string
    /** ISO 8601 — present on /v1/models. */
    created_at?: string
  }>
}

async function fetchAnthropicModels(): Promise<
  Array<Omit<ModelInfo, "provider">>
> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  })
  if (!res.ok) {
    throw new Error(`Anthropic /v1/models returned ${res.status}`)
  }
  const data = (await res.json()) as AnthropicListResponse
  // Collapse to one entry per family (opus / sonnet / haiku), keeping the
  // newest by created_at. Order by capability: opus → sonnet → haiku.
  const FAMILIES = ["opus", "sonnet", "haiku"] as const
  const latestPerFamily = new Map<
    (typeof FAMILIES)[number],
    AnthropicListResponse["data"][number]
  >()
  for (const m of data.data) {
    if (m.type === "deprecated") continue
    const family = FAMILIES.find((f) => m.id.includes(`-${f}-`))
    if (!family) continue
    const existing = latestPerFamily.get(family)
    const t = m.created_at ? Date.parse(m.created_at) : 0
    const et = existing?.created_at ? Date.parse(existing.created_at) : -1
    if (t > et) latestPerFamily.set(family, m)
  }
  return FAMILIES.flatMap((family) => {
    const m = latestPerFamily.get(family)
    if (!m) return []
    return [
      {
        id: `anthropic:${m.id}`,
        // Strip the leading "Claude " — the dropdown header already says
        // "Anthropic", so "Claude Sonnet 4.6" reads better as "Sonnet 4.6".
        label: (m.display_name ?? m.id).replace(/^Claude\s+/i, ""),
      },
    ]
  })
}

class AnthropicProvider implements ModelProvider {
  key = "anthropic"
  label = "Anthropic"

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY)
  }

  async listModels() {
    if (!this.isConfigured()) return []
    return discover({
      cacheKey: "providers:anthropic:models",
      fetchLive: fetchAnthropicModels,
      fallback: FALLBACK,
    })
  }

  resolve(modelId: string) {
    return anthropic(modelId)
  }
}

export function getAnthropicProvider(): ModelProvider {
  return new AnthropicProvider()
}
