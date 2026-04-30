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

  let interruptError: unknown = null
  try {
    await client.beta.sessions.events.send(sessionId, {
      events: [{ type: "user.interrupt" }],
    })
  } catch (e) {
    console.error("Stop interrupt failed:", e)
    interruptError = e
  }

  // End the streaming UI state for all clients regardless of whether the
  // upstream interrupt succeeded. The user's intent is to stop; if the
  // interrupt API itself errors, leaving the UI wedged in "thinking" is the
  // worst outcome.
  try {
    await broadcastChatEventViaDoc(roomId, { type: "chat-stream-end", chatId })
  } catch (e) {
    console.error("Stop broadcast failed:", e)
  }

  if (interruptError) {
    return new Response(
      interruptError instanceof Error ? interruptError.message : String(interruptError),
      { status: 500 },
    )
  }

  return Response.json({ success: true })
}
