import { openRoomForRoute } from "@/lib/room-access"
import { canvasFiles } from "@/lib/files"
import { removeAttachment, saveAttachment } from "@/lib/files/attach"
import { ATTACHMENT_MAX_BYTES, checkAttachment } from "@/lib/files/attachments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Chat attachments (#1525): a member's file, saved into the canvas's files
 * under `uploads/`.
 *
 * `POST /api/chat-attachments/<roomId>?name=<file name>` with the file's
 * bytes as the body answers `{ path, mediaType, size }`, or `{ error }` with
 * a sentence the composer shows. On hosted a body over 4.5 MB never reaches
 * a function, so a bigger file goes through `./direct` instead.
 *
 * `DELETE /api/chat-attachments/<roomId>?path=<path>` deletes an attachment
 * its sender took out of the composer before sending.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<Response> {
  const { roomId } = await params
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const name = new URL(req.url).searchParams.get("name")
  if (!name) return Response.json({ error: "Missing name." }, { status: 400 })
  const type = req.headers.get("content-type") ?? ""
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > ATTACHMENT_MAX_BYTES) {
    // Refused before reading, with the sentence the composer's check gives.
    const check = checkAttachment({ name, size: declared, type })
    const error = check.ok ? "That file is too big." : check.error
    return Response.json({ error }, { status: 413 })
  }
  const bytes = new Uint8Array(await req.arrayBuffer())
  const saved = await saveAttachment(canvasFiles(room), {
    name,
    type,
    bytes,
    userId: room.userId,
  })
  if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 })
  return Response.json(saved.value)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<Response> {
  const { roomId } = await params
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) return room

  const path = new URL(req.url).searchParams.get("path")
  if (!path) return Response.json({ error: "Missing path." }, { status: 400 })
  const removed = await removeAttachment(canvasFiles(room), path, room.userId)
  if (!removed.ok) {
    return Response.json({ error: removed.error }, { status: 404 })
  }
  return new Response(null, { status: 204 })
}
