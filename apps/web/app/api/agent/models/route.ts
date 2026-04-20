import { auth } from "@clerk/nextjs/server"
import { Redis } from "@upstash/redis"
import { getClient } from "@/lib/agent/config"

export const runtime = "nodejs"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

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

  const cached = await redis.get<ModelInfo[]>(CACHE_KEY)
  if (cached) return Response.json(cached)

  const client = getClient()
  const models: ModelInfo[] = []

  for await (const model of client.models.list({ limit: 100 })) {
    const label = (model.display_name ?? model.id).replace(/^Claude\s+/i, "")
    models.push({ id: model.id, label })
  }

  await redis.set(CACHE_KEY, models, { ex: CACHE_TTL_SECONDS })
  return Response.json(models)
}
