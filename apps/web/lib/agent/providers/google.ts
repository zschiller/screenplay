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
  const raw: Array<{ id: string; label: string }> = []
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
      // Skip preview/experimental variants — they're shadowed by the
      // stable alias for the same tier.
      if (/-(preview|exp|experimental)/.test(id)) continue
      raw.push({ id, label: m.displayName ?? id })
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }

  // Collapse to latest version per tier (pro / flash / flash-lite /
  // flash-8b). Order tiers by capability so the flagship lands at the top.
  const TIERS: Array<{ key: string; match: RegExp }> = [
    { key: "pro", match: /-pro(?:$|-)/ },
    { key: "flash", match: /-flash(?!-lite)(?!-8b)(?:$|-)/ },
    { key: "flash-lite", match: /-flash-lite(?:$|-)/ },
    { key: "flash-8b", match: /-flash-8b(?:$|-)/ },
  ]
  const latestPerTier = new Map<string, { id: string; label: string }>()
  for (const m of raw) {
    const tier = TIERS.find((t) => t.match.test(m.id))?.key
    if (!tier) continue
    const existing = latestPerTier.get(tier)
    if (!existing || parseVersion(m.id) > parseVersion(existing.id)) {
      latestPerTier.set(tier, m)
    }
  }
  return TIERS.flatMap((t) => {
    const m = latestPerTier.get(t.key)
    return m ? [{ id: `google:${m.id}`, label: m.label }] : []
  })
}

/** Parse `2.5` out of `gemini-2.5-pro` → 2.5. */
function parseVersion(id: string): number {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(id)
  return m ? parseFloat(m[1]!) : 0
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

  egress() {
    // Google authenticates via a `?key=` query param, not an auth header, so
    // there's no header for the firewall to overwrite — its key can't be
    // brokered through the egress transform.
    return null
  }
}

export function getGoogleProvider(): ModelProvider {
  return new GoogleProvider()
}
