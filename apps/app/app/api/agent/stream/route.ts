import { openRoomForRoute } from "@/lib/room-access"
import { launchTurn } from "@/lib/agent/turn-launch"
import {
  liveTurnLaunchDeps,
  markdownLayerTurn,
  sandboxTurn,
} from "@/lib/agent/turn-launch-live"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  /** Required when the chat targets an agent (sandbox-backed flow). */
  sandboxName?: string
  /** Required when the chat targets a document layer (no sandbox). */
  markdownLayerId?: string
  message: string
  isFirstChat?: boolean
  planMode?: boolean
  model?: string
  /** Comment threads this turn asks the agent to address (#788). */
  commentThreadIds?: string[]
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json()
  const { roomId, chatId, sandboxName, markdownLayerId, message, model } = body
  if (!roomId || !chatId || !message) {
    return new Response("Missing required fields", { status: 400 })
  }
  if (!markdownLayerId && !sandboxName) {
    return new Response("Missing target: markdownLayerId or sandboxName", {
      status: 400,
    })
  }

  // Room Access before anything is persisted, broadcast or launched.
  const room = await openRoomForRoute(roomId, chatId)
  if (room instanceof Response) return room
  const { userId } = room

  // Turn Launch owns the ordering (engine first, persist, start, broadcast,
  // drive after the response); this route only picks the Chat Target.
  const target = markdownLayerId
    ? markdownLayerTurn({ room, chatId, markdownLayerId, message, model })
    : sandboxTurn({
        room,
        chatId,
        sandboxName: sandboxName!,
        userId,
        message,
        isFirstChat: body.isFirstChat,
        planMode: body.planMode,
        model,
        commentThreadIds: body.commentThreadIds,
      })

  const result = await launchTurn(
    liveTurnLaunchDeps(room),
    { roomId, chatId, message, sandboxName, model },
    target
  )
  if (result.kind === "target-not-found") {
    return new Response("Layer not found", { status: 404 })
  }
  // Only a plan decision can find its plan resolved; this route sends none.
  if (result.kind === "plan-already-resolved") {
    return new Response("Plan already resolved", { status: 409 })
  }
  return Response.json({ chatId, runId: result.runId })
}
