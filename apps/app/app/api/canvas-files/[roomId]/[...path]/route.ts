import { openRoomForRoute } from "@/lib/room-access"
import { canvasFiles } from "@/lib/files"
import { fileResponse } from "@/lib/files/response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Serves one of a canvas's files (#1514) to a member of that canvas, and to
 * nobody else: the bytes sit in a private store, and this is the only way
 * out. `GET /api/canvas-files/<roomId>/<path>`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string; path: string[] }> }
): Promise<Response> {
  const { roomId, path } = await params
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const result = await canvasFiles(room).read(path.join("/"))
  if (!result.ok) return new Response("Not found", { status: 404 })
  return fileResponse(result.value.entry, result.value.bytes)
}
