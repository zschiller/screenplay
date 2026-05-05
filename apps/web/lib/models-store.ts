import type { ModelInfo } from "@/app/api/agent/models/route"

const AGENT_V2 = process.env.NEXT_PUBLIC_AGENT_V2 === "true"

let cache: ModelInfo[] | null = null
let pending: Promise<ModelInfo[]> | null = null

export async function getModels(): Promise<ModelInfo[]> {
  if (cache) return cache
  if (pending) return pending
  pending = fetch(AGENT_V2 ? "/api/agent/v2/models" : "/api/agent/models")
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ModelInfo[]
      cache = data
      return data
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export type { ModelInfo }
