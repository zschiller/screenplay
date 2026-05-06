import "server-only"

import { google } from "@ai-sdk/google"
import { discover } from "./cache"
import type { ModelInfo, ModelProvider } from "./types"

const FALLBACK: Array<Omit<ModelInfo, "provider">> = [
  { id: "google:gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
]

interface GoogleListResponse {
  models: Array<{
    name: string // "models/gemini-2.5-pro"
    displayName?: string
    supportedGenerationMethods?: string[]
    description?: string
  }>
  nextPageToken?: string
}

async function fetchGoogleModels(): Promise<
  Array<Omit<ModelInfo, "provider">>
> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) return []

  // Page through the listing — Google caps at ~50/page.
  const out: Array<Omit<ModelInfo, "provider">> = []
  let pageToken: string | undefined
  for (let i = 0; i < 5; i++) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models")
    url.searchParams.set("key", apiKey)
    url.searchParams.set("pageSize", "100")
    if (pageToken) url.searchParams.set("pageToken", pageToken)
    const res = await fetch(url.toString())
    if (!res.ok) {
      throw new Error(`Google list-models returned ${res.status}`)
    }
    const data = (await res.json()) as GoogleListResponse
    for (const m of data.models ?? []) {
      // Filter to chat-capable Gemini models. The list also includes
      // embedding-001, aqa, text-bison-*, etc. — none of which we want
      // surfaced in the dropdown.
      if (!m.supportedGenerationMethods?.includes("generateContent")) continue
      const id = m.name.replace(/^models\//, "")
      if (!id.startsWith("gemini-")) continue
      out.push({
        id: `google:${id}`,
        label: m.displayName ?? id,
      })
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return out
}

class GoogleProvider implements ModelProvider {
  key = "google"
  label = "Google"

  isConfigured() {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
  }

  async listModels() {
    if (!this.isConfigured()) return []
    return discover({
      cacheKey: "providers:google:models",
      fetchLive: fetchGoogleModels,
      fallback: FALLBACK,
    })
  }

  resolve(modelId: string) {
    return google(modelId)
  }
}

export function getGoogleProvider(): ModelProvider {
  return new GoogleProvider()
}
