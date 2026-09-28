import { getUserId } from "@/lib/auth-helpers"
import { chatRoomId, openRoomForRoute } from "@/lib/room-access"
import { loadChatTranscript } from "@/lib/agent/history-load"

export const runtime = "nodejs"

/**
 * Reload a chat from its ACP-native durable log (ADR 0006), through
 * {@link loadChatTranscript}. The chat's own Room decides who may read it.
 */
export async function GET(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const { searchParams } = new URL(req.url)
  const chatId = searchParams.get("chatId")
  if (!chatId) return Response.json([])

  // The chat's own Room decides who may read it. A chat no turn has recorded
  // yet has no history to read.
  const roomId = await chatRoomId(chatId)
  if (!roomId) return Response.json([])
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  return Response.json(await loadChatTranscript(chatId))
}
