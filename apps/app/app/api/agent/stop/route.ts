import { getUserId } from "@/lib/auth-helpers"
import { findActiveRun } from "@/lib/agent/persistence"
import { transition } from "@/lib/agent/run-state"
import { broadcastControl, broadcastSignal } from "@/lib/agent/broadcast"

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
    // Record the user's stop as `aborted` — the one outcome that means "the
    // user halted this with no continuation", distinct from the `superseded`
    // an approved/rejected plan or a new message records. The loop's watchdog
    // polls `isRunActive` every ABORT_POLL_INTERVAL_MS and aborts once this
    // lands; the machine's terminal guard keeps a duplicate /stop a no-op.
    await transition(active.id, "aborted")
    // Mark the transcript before the stream ends, so clients show the run as
    // stopped rather than finished. A reload rebuilds the same marker from the
    // run's `aborted` status (see /api/agent/history).
    await broadcastControl(roomId, chatId, { kind: "stopped" })
  }

  // Always end the streaming UI state, mirroring v1's stop semantics: the
  // user's intent to stop shouldn't depend on the loop's abort actually
  // landing this tick.
  await broadcastSignal(roomId, chatId, "chat-stream-end")

  return Response.json({ success: true })
}
