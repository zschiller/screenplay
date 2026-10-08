import { fileStore } from "@/lib/files"
import { mockupPageFor } from "@/lib/mockup-folder-server"
import { openRoomForViewer } from "@/lib/room-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * A Mockup's page for a viewer watching the canvas by its link (Sharing,
 * #1932), as `/api/mockup-folders` serves it to the host. Read only: a Mockup
 * from before folders gets its folder on the host's first read, not here.
 * `GET /s/<roomId>/<key>/mockups/<fileId>`.
 */
export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ roomId: string; key: string; fileId: string }> }
): Promise<Response> {
  const { roomId, key, fileId } = await params
  const room = await openRoomForViewer(roomId, key)
  if (!room) return new Response("Not found", { status: 404 })
  const body = await mockupPageFor(room, fileStore, fileId)
  if (!body) return new Response("Not found", { status: 404 })
  return Response.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  })
}
