import type { ModelInfo, ModelsResponse } from "@/app/api/agent/models/route"
import { withBasePath } from "@/lib/base-path"

/**
 * One fetch of the server's model catalog: the models this deployment can run
 * and its suggested default. Uncached — `lib/model-catalog` owns caching,
 * retry and loaded/failed state; this is only its HTTP adapter.
 */
export async function fetchModelCatalog(): Promise<ModelsResponse> {
  const res = await fetch(withBasePath("/api/agent/models"))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as ModelsResponse
}

export type { ModelInfo, ModelsResponse }
