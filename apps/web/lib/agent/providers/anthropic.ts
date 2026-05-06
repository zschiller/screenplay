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
  return data.data
    .filter((m) => m.type !== "deprecated")
    .sort((a, b) => {
      // Newest first by created_at — flagship/recent models float to the
      // top of the dropdown rather than alphabetical, which would lead
      // with whatever happens to start with the lowest letter.
      const at = a.created_at ? Date.parse(a.created_at) : 0
      const bt = b.created_at ? Date.parse(b.created_at) : 0
      return bt - at
    })
    .map((m) => ({
      id: `anthropic:${m.id}`,
      // The API gives a friendly display name like "Claude Sonnet 4.6"; strip
      // the leading "Claude " so the picker doesn't read "Claude Claude …"
      // alongside the section header.
      label: (m.display_name ?? m.id).replace(/^Claude\s+/i, ""),
    }))
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
