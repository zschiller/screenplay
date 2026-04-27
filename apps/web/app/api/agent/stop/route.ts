import { getUserId } from "@/lib/auth-helpers"
import { getClient } from "@/lib/agent/config"
import { broadcastChatEventViaDoc } from "@/lib/yjs/server"

export const runtime = "nodejs"

interface RequestBody {
  roomId: string
  chatId: string
  sessionId: string
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body: RequestBody = await req.json()
  const { roomId, chatId, sessionId } = body

  if (!roomId || !chatId || !sessionId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const client = getClient()

  try {
    await client.beta.sessions.events.send(sessionId, {
      events: [{ type: "user.interrupt" }],
    })
  } catch (e) {
    console.error("Stop interrupt failed:", e)
    return new Response(e instanceof Error ? e.message : String(e), { status: 500 })
  }

  // End the streaming UI state immediately for all clients. The background
  // stream from /api/agent/stream will also drain once the session idles, but
  // broadcasting here keeps the UI responsive even if it's mid-await.
  try {
    await broadcastChatEventViaDoc(roomId, { type: "chat-stream-end", chatId })
  } catch (e) {
    console.error("Stop broadcast failed:", e)
  }

  return Response.json({ success: true })
}
