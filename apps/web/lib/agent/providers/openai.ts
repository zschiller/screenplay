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
    /** Unix seconds — present on /v1/models. */
    created?: number
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

/**
 * OpenAI's listing returns both unversioned aliases (`gpt-4o`, `o1`,
 * `gpt-4-turbo`) and dated/version-pinned variants
 * (`gpt-4o-2024-08-06`, `o1-2024-12-17`, `gpt-4-0613`). Dated variants are
 * always shadowed by their alias, so dropping them collapses the list to
 * "latest per family" automatically.
 */
function isLatestAlias(id: string): boolean {
  // YYYY-MM-DD date suffix — the modern convention.
  if (/-\d{4}-\d{2}-\d{2}$/.test(id)) return false
  // MMDD pin — the legacy convention (`gpt-4-0613`, `gpt-3.5-turbo-0125`).
  if (/-\d{4}$/.test(id)) return false
  // Preview / staging / shadow models — keep production aliases only.
  if (/(preview|staging)/.test(id)) return false
  return true
}

/** Hardcoded capability rank for OpenAI families. Lower = earlier in the
 *  picker. Anything not matched falls through to `created` desc. */
const OPENAI_FAMILY_RANK: Array<[RegExp, number]> = [
  [/^gpt-5(?!-mini)(?!-nano)/, 0],
  [/^o3(?!-mini)/, 1],
  [/^o1(?!-mini)/, 2],
  [/^gpt-4o(?!-mini)/, 3],
  [/^chatgpt-4o/, 4],
  [/^gpt-4-turbo/, 5],
  [/^gpt-4(?!-)/, 6],
  [/^gpt-5-mini/, 7],
  [/^o3-mini/, 8],
  [/^o1-mini/, 9],
  [/^gpt-4o-mini/, 10],
  [/^gpt-5-nano/, 11],
  [/^gpt-3\.5/, 12],
]

function familyRank(id: string): number {
  for (const [pattern, rank] of OPENAI_FAMILY_RANK) {
    if (pattern.test(id)) return rank
  }
  return 999
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
    .filter((m) => isChatCapable(m.id) && isLatestAlias(m.id))
    .sort((a, b) => {
      const ar = familyRank(a.id)
      const br = familyRank(b.id)
      if (ar !== br) return ar - br
      // Tied rank (or both unmatched) — fall back to creation desc.
      return (b.created ?? 0) - (a.created ?? 0)
    })
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

  egress() {
    const key = process.env.OPENAI_API_KEY
    if (!key) return null
    return { host: "api.openai.com", headers: { authorization: `Bearer ${key}` } }
  }
}

export function getOpenAIProvider(): ModelProvider {
  return new OpenAIProvider()
}
