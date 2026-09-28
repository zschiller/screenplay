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
  branch?: string
  /** Required when the chat targets a document layer (no sandbox). */
  markdownLayerId?: string
  message: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
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
    ? markdownLayerTurn({ roomId, chatId, markdownLayerId, message, model })
    : sandboxTurn({
        roomId,
        chatId,
        sandboxName: sandboxName!,
        userId,
        message,
        branch: body.branch,
        isFirstChat: body.isFirstChat,
        autoNamedBranch: body.autoNamedBranch,
        planMode: body.planMode,
        model,
        commentThreadIds: body.commentThreadIds,
      })

  const result = await launchTurn(
    liveTurnLaunchDeps,
    { roomId, chatId, message, sandboxName, model },
    target
  )
  if (result.kind === "target-not-found") {
    return new Response("Layer not found", { status: 404 })
  }
  return Response.json({ chatId, runId: result.runId })
}
