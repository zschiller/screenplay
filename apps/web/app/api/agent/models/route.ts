import { getUserId } from "@/lib/auth-helpers"
import { enumerateModels, getDefaultModelId } from "@/lib/agent/providers"

export type { ModelInfo } from "@/lib/agent/providers"

export interface ModelsResponse {
  models: ReturnType<typeof enumerateModels>
  /** Suggested default if the user hasn't picked one. Null if no providers configured. */
  defaultModelId: string | null
}

export const runtime = "nodejs"

export async function GET() {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })
  const body: ModelsResponse = {
    models: enumerateModels(),
    defaultModelId: getDefaultModelId(),
  }
  return Response.json(body)
}
