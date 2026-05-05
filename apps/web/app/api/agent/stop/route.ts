import { getUserId } from "@/lib/auth-helpers"
import { abortRun, findActiveRun } from "@/lib/agent/persistence"
import { broadcastSignal } from "@/lib/agent/broadcast"

export const runtime = "nodejs"

interface RequestBody {
  roomId: string
  chatId: string
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body: RequestBody = await req.json()
  const { roomId, chatId } = body
  if (!roomId || !chatId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const active = await findActiveRun(chatId)
  if (active) {
    // The streamText loop polls this flag every ABORT_POLL_INTERVAL_MS and
    // calls AbortController.abort() when it flips to true. Marking the run
    // ended here too keeps stop idempotent — a duplicate stop is a no-op.
    await abortRun(active.id)
  }

  // Always end the streaming UI state, mirroring v1's stop semantics: the
  // user's intent to stop shouldn't depend on the loop's abort actually
  // landing this tick.
  await broadcastSignal(roomId, chatId, "chat-stream-end")

  return Response.json({ success: true })
}
