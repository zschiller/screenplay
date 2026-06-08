import type { ModelInfo, ModelsResponse } from "@/app/api/agent/models/route"
import { withBasePath } from "@/lib/base-path"

let cache: ModelsResponse | null = null
let pending: Promise<ModelsResponse> | null = null

function fetchCatalog(): Promise<ModelsResponse> {
  if (cache) return Promise.resolve(cache)
  if (pending) return pending
  pending = fetch(withBasePath("/api/agent/models"))
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ModelsResponse
      cache = data
      return data
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export async function getModels(): Promise<ModelInfo[]> {
  return (await fetchCatalog()).models
}

/**
 * Server-suggested default model. Honors AGENT_DEFAULT_MODEL when its
 * provider is configured, otherwise falls back to the first enabled model.
 * Null only when no providers are configured at all.
 */
export async function getDefaultModelId(): Promise<string | null> {
  return (await fetchCatalog()).defaultModelId
}

export type { ModelInfo }
