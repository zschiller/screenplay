import { getUserId } from "@/lib/auth-helpers"
import { getClient } from "@/lib/agent/config"
import { broadcastChatEventViaDoc } from "@/lib/yjs/server"

export const runtime = "nodejs"

interface RequestBody {
  roomId: string
  chatId: string
  sessionId: string
}

/**
 * Reconcile a chat's `isStreaming` flag against the actual Anthropic session
 * state. If the session is no longer making progress (idle or terminated) but
 * the UI still shows it as streaming, broadcast `chat-stream-end` to unstick
 * it. No-op when the session is still `running`/`rescheduling` — those are
 * legitimately in-progress states.
 */
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

  let status: string
  try {
    const session = await client.beta.sessions.retrieve(sessionId)
    status = session.status
  } catch (e) {
    // Session lookup failed — treat as terminal so the UI doesn't stay stuck.
    console.error("Heal session lookup failed:", e)
    await broadcastChatEventViaDoc(roomId, { type: "chat-stream-end", chatId })
    return Response.json({ healed: true, reason: "lookup_failed" })
  }

  if (status === "running" || (status as string) === "rescheduling") {
    // Genuinely in progress — leave the spinner alone.
    return Response.json({ healed: false, status })
  }

  // idle or terminated → there is no live stream producing events for this
  // chat, so the UI's `isStreaming` flag is stale. Clear it.
  try {
    await broadcastChatEventViaDoc(roomId, { type: "chat-stream-end", chatId })
  } catch (e) {
    console.error("Heal broadcast failed:", e)
  }
  return Response.json({ healed: true, status })
}
