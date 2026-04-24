import { auth } from "@clerk/nextjs/server"
import { kv } from "@/lib/kv"
import { getClient } from "@/lib/agent/config"

export const runtime = "nodejs"

const CACHE_KEY = "anthropic:models:v2"
const CACHE_TTL_SECONDS = 3600

export interface ModelInfo {
  id: string
  label: string
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const cached = await kv.get<ModelInfo[]>(CACHE_KEY)
  if (cached) return Response.json(cached)

  const client = getClient()
  const models: ModelInfo[] = []

  for await (const model of client.models.list({ limit: 100 })) {
    const label = (model.display_name ?? model.id).replace(/^Claude\s+/i, "")
    models.push({ id: model.id, label })
  }

  await kv.set(CACHE_KEY, models, { ex: CACHE_TTL_SECONDS })
  return Response.json(models)
}
