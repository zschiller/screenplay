import { openRoomForRoute } from "@/lib/room-access"
import { stopTurn } from "@/lib/agent/turn-launch"
import { liveTurnStopDeps } from "@/lib/agent/turn-launch-live"

export const runtime = "nodejs"

interface RequestBody {
  roomId: string
  chatId: string
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json()
  const { roomId, chatId } = body
  if (!roomId || !chatId) {
    return new Response("Missing required fields", { status: 400 })
  }

  const room = await openRoomForRoute(roomId, chatId)
  if (room instanceof Response) return room

  // Turn Launch owns what a stop records and shows, live and on reload.
  await stopTurn(liveTurnStopDeps, { roomId, chatId })

  return Response.json({ success: true })
}
