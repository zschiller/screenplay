import { openRoomForRoute } from "@/lib/room-access"
import type { FrameDriveAnswerBody } from "@/lib/frame-drive/view/asks"
import { frameDriveAnswers } from "@/lib/frame-drive/view/live"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * An answer from the asker's canvas to an op the agent sent it on hosted
 * (#1391): taken only from the person the op was for, in its Room, so nobody
 * else can answer for their canvas.
 */
export async function POST(req: Request) {
  const body = (await req
    .json()
    .catch(() => ({}))) as Partial<FrameDriveAnswerBody>
  const roomId = typeof body.room === "string" ? body.room : ""
  const answer = body.answer
  if (!roomId || !answer || typeof answer.id !== "string") {
    return Response.json(
      { error: "room and answer are required" },
      { status: 400 }
    )
  }

  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const accepted = await frameDriveAnswers.accept(answer, {
    roomId,
    viewer: room.userId,
  })
  if (!accepted) {
    return Response.json({ error: "No such op for you" }, { status: 404 })
  }
  return new Response(null, { status: 204 })
}
