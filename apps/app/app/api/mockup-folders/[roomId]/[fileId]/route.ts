import { fileStore } from "@/lib/files"
import type { MockupPageResponse } from "@/lib/mockup-folder"
import { mockupFolderOn, mockupPageBase } from "@/lib/mockup-folder-server"
import { openRoomForRoute } from "@/lib/room-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * A Mockup's page for a member's canvas (#1886): its `index.html`, its
 * revision, and the pages-route base its relative paths load from, signed
 * for this Mockup (`lib/mockup-folder`). A Mockup from before folders gets
 * its folder here, on its first read.
 * `GET /api/mockup-folders/<roomId>/<fileId>`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string; fileId: string }> }
): Promise<Response> {
  const { roomId, fileId } = await params
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const page = await mockupFolderOn(room, fileStore).page(fileId)
  if (!page) return new Response("Not found", { status: 404 })
  const base = mockupPageBase(roomId, page.fileId, page.revision)
  const body: MockupPageResponse = {
    html: page.html,
    revision: page.revision,
    base: base.path,
    expiresAt: base.expiresAt,
  }
  return Response.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  })
}

/**
 * Removes a deleted Mockup's folder for good, once the canvas that deleted
 * it can no longer undo that (#1886). Refused while the Mockup is still in
 * the room, so a stale ask never loses a page.
 * `DELETE /api/mockup-folders/<roomId>/<fileId>`.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ roomId: string; fileId: string }> }
): Promise<Response> {
  const { roomId, fileId } = await params
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const purged = await mockupFolderOn(room, fileStore).purge(fileId)
  return purged
    ? new Response(null, { status: 204 })
    : new Response("The Mockup is still on the canvas.", { status: 409 })
}
