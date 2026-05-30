import { getUserId } from "@/lib/auth-helpers"
import { findActiveRun } from "@/lib/agent/persistence"
import { broadcastSignal } from "@/lib/agent/broadcast"

export const runtime = "nodejs"

interface RequestBody {
  roomId: string
  chatId: string
}

/**
 * If the chat's UI thinks it's still streaming but no run row is in a
 * non-ended state, broadcast chat-stream-end so the spinner clears.
 * paused_for_plan counts as "still doing something" and is left alone.
 */
export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body: RequestBody = await req.json()
  const { roomId, chatId } = body
  if (!roomId || !chatId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const active = await findActiveRun(chatId)
  if (active?.status === "running") {
    return Response.json({ healed: false, status: active.status })
  }

  await broadcastSignal(roomId, chatId, "chat-stream-end")
  return Response.json({ healed: true, status: active?.status ?? "ended" })
}
