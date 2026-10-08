import { loadChatTranscript } from "@/lib/agent/history-load"
import { chatRoomId, openRoomForViewer } from "@/lib/room-access"

/**
 * A chat's transcript for a viewer (Sharing, #1933): `?chatId=<chat>`, for a
 * chat recorded under this canvas. The viewer's stand-in for
 * `/api/agent/history`, which reads the host's session. Live steps reach the
 * viewer through the canvas's Yjs doc, as they reach the host.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string; key: string }> }
) {
  const { roomId, key } = await params
  const room = await openRoomForViewer(roomId, key)
  if (!room) return new Response("Not found", { status: 404 })
  const chatId = new URL(request.url).searchParams.get("chatId")
  if (!chatId) return Response.json([])
  // A chat no turn has recorded yet has nothing to read; another canvas's
  // chat isn't this link's to show.
  const chatRoom = await chatRoomId(chatId)
  if (chatRoom === null) return Response.json([])
  if (chatRoom !== roomId) return new Response("Not found", { status: 404 })
  return Response.json(await loadChatTranscript(chatId), {
    headers: { "Cache-Control": "no-store" },
  })
}
