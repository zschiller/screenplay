import { openRoomForRoute } from "@/lib/room-access"
import { driveToken, frameStreamKey } from "@/lib/frame-stream/token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * A drive grant for a shared frame (#1392): signed only for the person Frame
 * Control says drives it, so a watcher's input never reaches the page. The
 * client sends it over the stream and asks again before it expires.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    room?: unknown
    frame?: unknown
  }
  const roomId = typeof body.room === "string" ? body.room : ""
  const frameId = typeof body.frame === "string" ? body.frame : ""
  if (!roomId || !frameId) {
    return Response.json(
      { error: "room and frame are required" },
      { status: 400 }
    )
  }

  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const found = await room.readDoc((c) => {
    const layer = c.iframeLayers.get(frameId)
    const branch = layer?.branchId ? c.branches.get(layer.branchId) : undefined
    return { branch, driver: c.frameControl.get(frameId)?.driver ?? null }
  })
  if (!found.branch) {
    return Response.json({ error: "No such frame" }, { status: 404 })
  }
  if (found.driver !== room.userId) {
    return Response.json(
      { error: "Someone else drives this frame" },
      { status: 409 }
    )
  }

  return Response.json(
    driveToken(frameStreamKey(found.branch.sandboxName), room.userId, frameId)
  )
}
