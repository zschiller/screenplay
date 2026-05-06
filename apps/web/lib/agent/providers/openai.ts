import "server-only"

import { openai } from "@ai-sdk/openai"
import { discover } from "./cache"
import type { ModelInfo, ModelProvider } from "./types"

const FALLBACK: Array<Omit<ModelInfo, "provider">> = [
  { id: "openai:gpt-4o", label: "GPT-4o" },
  { id: "openai:gpt-4o-mini", label: "GPT-4o mini" },
  { id: "openai:o1", label: "o1" },
  { id: "openai:o1-mini", label: "o1-mini" },
]

interface OpenAIListResponse {
  data: Array<{
    id: string
    object?: string
    owned_by?: string
  }>
}

/** OpenAI's `/v1/models` returns embeddings, dall-e, tts, whisper, etc. mixed
 *  in with chat models. There's no `type` field, so filter by id substring. */
function isChatCapable(id: string): boolean {
  const lc = id.toLowerCase()
  if (
    lc.includes("embed") ||
    lc.includes("whisper") ||
    lc.includes("tts") ||
    lc.includes("dall-e") ||
    lc.includes("moderation") ||
    lc.includes("audio") ||
    lc.includes("realtime") ||
    lc.includes("image") ||
    lc.includes("transcribe") ||
    lc.includes("babbage") ||
    lc.includes("davinci") ||
    lc.includes("instruct")
  ) return false
  return /^(gpt-|o\d|chatgpt-)/.test(lc)
}

async function fetchOpenAIModels(): Promise<
  Array<Omit<ModelInfo, "provider">>
> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return []
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`OpenAI /v1/models returned ${res.status}`)
  }
  const data = (await res.json()) as OpenAIListResponse
  return data.data
    .filter((m) => isChatCapable(m.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({
      id: `openai:${m.id}`,
      label: m.id,
    }))
}

class OpenAIProvider implements ModelProvider {
  key = "openai"
  label = "OpenAI"

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY)
  }

  async listModels() {
    if (!this.isConfigured()) return []
    return discover({
      cacheKey: "providers:openai:models",
      fetchLive: fetchOpenAIModels,
      fallback: FALLBACK,
    })
  }

  resolve(modelId: string) {
    return openai(modelId)
  }
}

export function getOpenAIProvider(): ModelProvider {
  return new OpenAIProvider()
}
