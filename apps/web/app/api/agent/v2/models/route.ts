import { getUserId } from "@/lib/auth-helpers"
import { enumerateModels } from "@/lib/agent/v2/providers"

export const runtime = "nodejs"

export async function GET() {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })
  return Response.json(enumerateModels())
}
